import express, { type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import cron, { type ScheduledTask } from 'node-cron'
import { mkdirSync, existsSync, readdirSync, rmSync } from 'fs'
import { join, basename } from 'path'
import Anthropic from '@anthropic-ai/sdk'

import { appPaths, config, assertConfig, type AppPaths } from './config'
import { handleLogin, handleLogout, isAuthed, requireAuth } from './auth'
import { sseHandler, emitProgress, emitLog, emitIdeaVideo } from './sse'
import { generateVideoFromIdea, chooseMusicTrack } from './video-gen'
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getApiKeyMasked,
  hasApiKey,
  getEncrypted,
  setEncrypted
} from './secrets'
import * as repo from '../src/main/db/repo'
import { initDb } from '../src/main/db/client'
import {
  resolveBinaries,
  ensureWhisper,
  ensureFaceCascade,
  updateYtDlp,
  installPotPlugin
} from '../src/main/binaries/manager'
import { runPipeline, type ReframeFocus } from '../src/main/pipeline/orchestrator'
import { transcribeSource, transcribeWithGroq, type Word } from '../src/main/pipeline/transcribe'
import { detectFaceCenterX } from '../src/main/pipeline/face'
import { isLocalFile } from '../src/main/pipeline/ingest'
import { downloadViaApi, isYouTubeUrl, type SourceMetaApi } from './ytdl-api'
import { listUploadPostProfiles, type UploadPostProfile } from '../src/main/publish/uploadpost'
import { generateViralIdeas, fetchTikTokTrends } from './ideas'
import type { PipelineContext } from '../src/main/pipeline/context'
import type { Usage } from '../src/main/pipeline/highlights'
import type { ProgressEvent } from '../src/shared/types'
import {
  getTikTokConfig,
  saveTikTokTokens,
  clearTikTokTokens,
  tiktokConnected,
  getTikTokAuthUrl,
  submitTikTokCode,
  checkTikTokCreator,
  getTikTokProfile,
  publishClipById,
  uploadPostProfiles,
  activeProfile
} from './tiktok-service'
import type { PublishOverrides } from '../src/main/publish/index'

const FLAG_TRANSCRIBE = 'transcribe_enabled'
const FLAG_TRANSCRIBE_BACKEND = 'transcribe_backend'
const FLAG_MODEL = 'highlights_model'
const FLAG_REFRAME = 'reframe_focus'
const SPEND_USD = 'spend_usd'
const SPEND_IN = 'spend_in'
const SPEND_OUT = 'spend_out'

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8'
}
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 }
}

function addSpend(model: string, usage: Usage): void {
  const p = PRICES[model] ?? PRICES['claude-haiku-4-5']
  const cost = (usage.input_tokens * p.in + usage.output_tokens * p.out) / 1_000_000
  repo.setSetting(SPEND_USD, String((parseFloat(repo.getSetting(SPEND_USD) ?? '0') || 0) + cost))
  repo.setSetting(SPEND_IN, String((parseInt(repo.getSetting(SPEND_IN) ?? '0', 10) || 0) + usage.input_tokens))
  repo.setSetting(SPEND_OUT, String((parseInt(repo.getSetting(SPEND_OUT) ?? '0', 10) || 0) + usage.output_tokens))
}

const paths: AppPaths = appPaths()
const musicDir = join(paths.data, 'music')
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|opus)$/i
function musicTracks(): string[] {
  return existsSync(musicDir) ? readdirSync(musicDir).filter((f) => AUDIO_RE.test(f)) : []
}

let ctxPromise: Promise<PipelineContext> | null = null
function getContext(): Promise<PipelineContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const bin = await resolveBinaries(paths.bin, emitLog)
      return { bin, dirs: { downloads: paths.downloads, clips: paths.clips, bin: paths.bin } }
    })()
  }
  return ctxPromise
}

// ── Pipeline (un seul à la fois) ──
let pipelineChain: Promise<void> = Promise.resolve()

async function runForSource(sourceId: number, clipCount: number): Promise<void> {
  const source = repo.getSource(sourceId)
  if (!source) throw new Error(`Source #${sourceId} introuvable`)
  const send = (ev: ProgressEvent): void => emitProgress(ev)
  const log = (m: string): void =>
    send({ sourceId, stage: 'ingest', status: 'running', progress: 0, message: m })

  const apiKey = getApiKey()
  const model = MODEL_MAP[repo.getSetting(FLAG_MODEL) ?? 'haiku'] ?? MODEL_MAP.haiku
  const reframeFocus = (repo.getSetting(FLAG_REFRAME) as ReframeFocus) || 'center'
  const transcribeEnabled = repo.getSetting(FLAG_TRANSCRIBE) === '1'
  const backend = repo.getSetting(FLAG_TRANSCRIBE_BACKEND) || 'groq'
  const groqKey = getEncrypted('groq_key')
  const rapidApiKey = getEncrypted('rapidapi_key')
  const cookiesFile = repo.getSetting('ytdlp_cookies_file') || null
  const autoApprove = repo.getSetting('auto_approve') === '1'

  repo.updateSource(sourceId, { status: 'running', error: null })
  try {
    const ctx = await getContext()

    // Téléchargement via RapidAPI : sur le VPS, l'IP datacenter est bloquée par
    // YouTube → yt-dlp échoue. Si une clé est configurée et que l'URL est YouTube,
    // on récupère le MP4 via l'API et on passe ensuite un fichier LOCAL au pipeline
    // (qui le détecte via isLocalFile et saute yt-dlp).
    let effectiveUrl = source.url
    let apiMeta: SourceMetaApi | null = null
    if (rapidApiKey && !isLocalFile(source.url) && isYouTubeUrl(source.url)) {
      const dl = await downloadViaApi(
        ctx,
        rapidApiKey,
        source.url,
        sourceId,
        (ratio) =>
          send({ sourceId, stage: 'ingest', status: 'running', progress: ratio, message: 'Téléchargement (API)…' }),
        log
      )
      effectiveUrl = dl.filePath
      apiMeta = dl.meta
      repo.updateSource(sourceId, {
        title: apiMeta.title,
        author: apiMeta.author,
        durationSec: apiMeta.durationSec,
        filePath: dl.filePath
      })
    }
    const transcribe: ((sourceFile: string, sid: number) => Promise<Word[]>) | null =
      !transcribeEnabled
        ? null
        : (sourceFile, sid) => {
            if (backend === 'groq' && groqKey) return transcribeWithGroq(ctx, groqKey, sourceFile, sid)
            return ensureWhisper(paths.bin, paths.models, log).then((w) =>
              transcribeSource(ctx, w, sourceFile, sid)
            )
          }
    const detectFace =
      reframeFocus === 'face'
        ? (sourceFile: string, start: number, end: number): Promise<number | null> =>
            ensureFaceCascade(paths.models, log)
              .then((cascade) => detectFaceCenterX(ctx, sourceFile, start, end, cascade))
              .catch(() => null)
        : null

    await runPipeline(
      ctx,
      { id: source.id, url: effectiveUrl },
      {
        emit: send,
        onMeta: (m) =>
          repo.updateSource(sourceId, {
            title: apiMeta?.title ?? m.title,
            author: apiMeta?.author ?? m.author,
            durationSec: m.durationSec ?? apiMeta?.durationSec
          }),
        onSourceFile: (fp) => repo.updateSource(sourceId, { filePath: fp }),
        onClip: (c) => {
          const clip = repo.createClip({
            sourceId,
            startSec: c.startSec,
            endSec: c.endSec,
            filePath: c.filePath,
            score: c.score,
            reason: c.reason,
            title: c.title,
            description: c.description,
            hashtags: c.hashtags,
            profile: activeProfile()
          })
          if (autoApprove) repo.setClipReview(clip.id, 'approved')
        },
        onUsage: (m, usage) => addSpend(m, usage)
      },
      { apiKey, model, transcribe, reframeFocus, detectFace, cookiesFromBrowser: null, cookiesFile, clipCount }
    )
    repo.updateSource(sourceId, { status: 'done' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    repo.updateSource(sourceId, { status: 'error', error: msg })
    send({ sourceId, stage: 'ingest', status: 'error', progress: 0, message: msg })
  }
}

// Prochaine occurrence d'une expression cron (5 champs), à la minute près.
function cronNext(expr: string, from: Date): Date | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [min, hr, dom, mon, dow] = fields
  const match = (val: number, field: string, base: number): boolean => {
    if (field === '*') return true
    for (const part of field.split(',')) {
      if (part.startsWith('*/')) {
        const step = Number(part.slice(2))
        if (step > 0 && (val - base) % step === 0) return true
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number)
        if (val >= a && val <= b) return true
      } else if (Number(part) === val) return true
    }
    return false
  }
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dowVal = d.getDay() // 0=dimanche
    if (
      match(d.getMinutes(), min, 0) &&
      match(d.getHours(), hr, 0) &&
      match(d.getDate(), dom, 1) &&
      match(d.getMonth() + 1, mon, 1) &&
      (match(dowVal, dow, 0) || match(dowVal === 0 ? 7 : dowVal, dow, 0))
    ) {
      return d
    }
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

// ── Scheduler ──
let task: ScheduledTask | null = null
function reloadScheduler(): void {
  if (task) {
    task.stop()
    task = null
  }
  if (repo.getSetting('schedule_enabled') !== '1') return
  const expr = repo.getSetting('schedule_cron') || '*/30 * * * *'
  if (!cron.validate(expr)) {
    emitLog(`Planification : expression cron invalide « ${expr} ».`)
    return
  }
  task = cron.schedule(expr, () => {
    void (async () => {
      if (repo.getSetting('queue_paused') === '1') {
        emitLog('Planification : file en pause, publication ignorée.')
        return
      }
      const cooldownUntil = Number(repo.getSetting('uploadpost_cooldown_until')) || 0
      if (Date.now() < cooldownUntil) {
        emitLog(`Planification : upload-post limite les requêtes → pause jusqu'à ${new Date(cooldownUntil).toLocaleTimeString()}.`)
        return
      }
      // Profil actif (choisi en haut à droite). Si son quota journalier a été
      // atteint récemment, on ne retente qu'après ~30 min (auto-détection de reprise).
      const target = activeProfile()
      const quotaTs = Number(repo.getSetting(`quota_reached_${target}`)) || 0
      if (quotaTs && Date.now() - quotaTs < 30 * 60 * 1000) {
        emitLog(`Planification : quota atteint pour « ${target} » — prochaine tentative dans ~30 min.`)
        return
      }
      const clip = repo.nextApprovedUnpublished()
      if (!clip) {
        emitLog('Planification : aucun clip validé en attente.')
        return
      }
      try {
        await publishClipById(clip.id, paths, emitLog)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/\b429\b|too many requests/i.test(msg)) {
          // upload-post limite le nombre de requêtes → pause courte, ça se rétablit vite.
          repo.setSetting('uploadpost_cooldown_until', String(Date.now() + 8 * 60 * 1000))
          emitLog('Planification : upload-post limite les requêtes (429) → pause 8 min.')
        }
        // spam_risk : publishClipById a déjà posé le « quota atteint » du profil →
        // la bannière s'affiche et le scheduler retentera dans ~30 min (voir plus haut).
      }
    })()
  })
  emitLog(`Planification activée (cron « ${expr} »).`)
}

// ── Génération de vidéo « faceless » depuis une idée (une à la fois) ──
let videoChain: Promise<void> = Promise.resolve()
async function runVideoGen(ideaId: number): Promise<void> {
  const idea = repo.getIdea(ideaId)
  if (!idea) return
  const anthropicKey = getApiKey()
  const openaiKey = getEncrypted('openai_key')
  if (!anthropicKey) return emitIdeaVideo({ ideaId, status: 'error', message: 'Clé Claude manquante (Réglages).' })
  if (!openaiKey) return emitIdeaVideo({ ideaId, status: 'error', message: 'Clé OpenAI manquante (Réglages).' })
  const model = MODEL_MAP[repo.getSetting(FLAG_MODEL) ?? 'haiku'] ?? MODEL_MAP.haiku
  try {
    emitIdeaVideo({ ideaId, status: 'running', message: 'Démarrage…' })
    const ctx = await getContext()
    const tracks = musicTracks()
    let musicTrack: string | undefined
    if (tracks.length) {
      emitIdeaVideo({ ideaId, status: 'running', message: 'Choix de la musique (IA)…' })
      const chosen = await chooseMusicTrack(anthropicKey, model, idea, tracks)
      if (chosen) {
        musicTrack = join(musicDir, chosen)
        emitIdeaVideo({ ideaId, status: 'running', message: `Musique : ${chosen.replace(/^\d+-/, '').replace(/\.[^.]+$/, '')}` })
      }
    }
    const { filePath, durationSec, usage } = await generateVideoFromIdea(ctx, {
      anthropicKey,
      anthropicModel: model,
      openaiKey,
      voice: repo.getSetting('tts_voice') || 'onyx',
      idea,
      musicTrack,
      onProgress: (m) => emitIdeaVideo({ ideaId, status: 'running', message: m })
    })
    if (usage) addSpend(model, usage)
    const source = repo.createSource(`idea:${ideaId}`)
    repo.updateSource(source.id, { status: 'done', title: idea.title, durationSec, filePath })
    const clip = repo.createClip({
      sourceId: source.id,
      startSec: 0,
      endSec: durationSec,
      filePath,
      title: idea.title,
      description: idea.hook,
      hashtags: idea.hashtags.join(' '),
      reason: 'Vidéo générée depuis une idée',
      profile: activeProfile()
    })
    if (repo.getSetting('auto_approve') === '1') repo.setClipReview(clip.id, 'approved')
    emitIdeaVideo({ ideaId, status: 'done', message: 'Vidéo prête ✅' })
  } catch (e) {
    emitIdeaVideo({ ideaId, status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

// ── Bootstrap ──
assertConfig()
for (const dir of [paths.downloads, paths.clips, paths.bin, paths.models, paths.uploads, musicDir]) {
  mkdirSync(dir, { recursive: true })
}
initDb(paths.data)
reloadScheduler()

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, paths.uploads),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`)
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }
})

const app = express()
app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))

// Auth publique
app.post('/api/login', handleLogin)
app.post('/api/logout', handleLogout)
app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req) }))

// Callback OAuth TikTok (public) : TikTok y redirige avec ?code=… ; on échange
// le code (PKCE) et on revient au dashboard, sans copier-coller manuel.
app.get('/api/tiktok/callback', async (req, res) => {
  const code = String(req.query.code ?? '')
  const err = String(req.query.error ?? '')
  if (err || !code) {
    res.redirect('/?tiktok=error')
    return
  }
  try {
    await submitTikTokCode(code)
    res.redirect('/?tiktok=connected')
  } catch {
    res.redirect('/?tiktok=error')
  }
})

// Tout le reste de l'API est protégé
app.use('/api', requireAuth)
app.use('/media', requireAuth)

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve(fn(req, res)).catch((e) => res.status(500).json({ error: String(e?.message ?? e) }))
}

// Événements temps réel
app.get('/api/events', sseHandler)

// Sources
app.get('/api/sources', wrap((_req, res) => res.json(repo.listSources())))
app.post('/api/sources', wrap((req, res) => {
  const url = String(req.body?.url ?? '').trim()
  if (!url) return res.status(400).json({ error: 'URL manquante' })
  res.json(repo.createSource(url))
}))
app.post('/api/sources/upload', upload.single('file'), wrap((req, res) => {
  const f = (req as Request & { file?: Express.Multer.File }).file
  if (!f) return res.status(400).json({ error: 'Fichier manquant' })
  res.json(repo.createSource(f.path))
}))

// Clips
app.get('/api/clips', wrap((req, res) => {
  const sid = req.query.sourceId ? Number(req.query.sourceId) : undefined
  res.json(repo.listClips(sid))
}))
app.post('/api/clips/:id/review', wrap((req, res) => {
  repo.setClipReview(Number(req.params.id), req.body?.status)
  res.json({ ok: true })
}))
app.post('/api/clips/:id/publish', wrap(async (req, res) => {
  const overrides = req.body?.overrides as PublishOverrides | undefined
  await publishClipById(Number(req.params.id), paths, emitLog, overrides)
  res.json({ ok: true })
}))

// Pipeline
app.post('/api/pipeline/run', wrap((req, res) => {
  const sourceId = Number(req.body?.sourceId)
  const clipCount = Math.min(10, Math.max(1, Math.round(Number(req.body?.clipCount ?? 3))))
  if (!sourceId) return res.status(400).json({ error: 'sourceId manquant' })
  // Marque la source « en file d'attente » immédiatement (avant son tour).
  repo.updateSource(sourceId, { status: 'queued', error: null })
  emitProgress({ sourceId, stage: 'ingest', status: 'running', progress: 0, message: 'En file d’attente…' })
  const job = pipelineChain.then(() => runForSource(sourceId, clipCount))
  pipelineChain = job.then(() => undefined, () => undefined)
  res.json({ ok: true })
}))

// Idées virales (Claude) + tendances réelles (RapidAPI)
app.post('/api/ideas', wrap(async (req, res) => {
  const apiKey = getApiKey()
  if (!apiKey) return res.status(400).json({ error: 'Configure d’abord ta clé API Claude dans les Réglages.' })
  const niche = String(req.body?.niche ?? '').trim()
  if (!niche) return res.status(400).json({ error: 'Précise une niche ou un thème.' })
  const count = Math.min(8, Math.max(1, Math.round(Number(req.body?.count ?? 4))))
  const trends = Array.isArray(req.body?.trends) ? (req.body.trends as unknown[]).map(String).slice(0, 25) : []
  const model = MODEL_MAP[repo.getSetting(FLAG_MODEL) ?? 'haiku'] ?? MODEL_MAP.haiku
  const { ideas, usage } = await generateViralIdeas({ apiKey, model, niche, count, trends })
  if (usage) addSpend(model, usage)
  // On enregistre chaque idée générée (page « Mes idées »).
  const saved = ideas.map((idea) => repo.createIdea(niche, idea))
  res.json({ ideas: saved })
}))
// Cache des profils upload-post (avatar + @handle) pour ne pas spammer l'API (429).
let profilesCache: { at: number; data: UploadPostProfile[] } | null = null
async function cachedUploadPostProfiles(): Promise<UploadPostProfile[]> {
  const key = getEncrypted('uploadpost_key')
  if (!key) return []
  if (profilesCache && Date.now() - profilesCache.at < 5 * 60 * 1000) return profilesCache.data
  try {
    const data = await listUploadPostProfiles(key)
    profilesCache = { at: Date.now(), data }
    return data
  } catch {
    return profilesCache?.data ?? [] // en cas d'erreur (429), on réutilise le dernier cache
  }
}

// État de publication : profils (avatar + @handle), profil actif, quota atteint
app.get('/api/publish/state', wrap(async (_req, res) => {
  const mode = repo.getSetting('publish_mode') || 'export'
  const usernames = uploadPostProfiles()
  const active = activeProfile()
  const all = await cachedUploadPostProfiles()
  const byName = new Map(all.map((p) => [p.username, p]))
  const profiles = usernames.map((u) => {
    const p = byName.get(u)
    return { username: u, handle: p?.tiktokHandle ?? null, avatarUrl: p?.avatarUrl ?? null }
  })
  const quotaTs = Number(repo.getSetting(`quota_reached_${active}`)) || 0
  // On considère le quota « atteint » tant que le drapeau a moins de 24 h
  // (fenêtre glissante TikTok) — sinon on l'ignore (garde-fou anti-bannière figée).
  const quotaReached = quotaTs > 0 && Date.now() - quotaTs < 24 * 60 * 60 * 1000
  res.json({ mode, profiles, active, quotaReached, quotaProfile: quotaReached ? active : null })
}))

app.get('/api/ideas/saved', wrap((_req, res) => res.json({ ideas: repo.listIdeas() })))
app.delete('/api/ideas/:id', wrap((req, res) => {
  repo.deleteIdea(Number(req.params.id))
  res.json({ ok: true })
}))
// Génère une vidéo « faceless » à partir d'une idée enregistrée (asynchrone, progression via SSE)
app.post('/api/ideas/:id/video', wrap((req, res) => {
  const id = Number(req.params.id)
  if (!repo.getIdea(id)) return res.status(404).json({ error: 'Idée introuvable' })
  if (!getEncrypted('openai_key')) return res.status(400).json({ error: 'Configure ta clé OpenAI dans les Réglages.' })
  videoChain = videoChain.then(() => runVideoGen(id)).then(() => undefined, () => undefined)
  res.json({ ok: true })
}))

// Clé OpenAI (voix off + images pour la génération de vidéos)
app.get('/api/settings/openai', wrap((_req, res) => res.json({ has: !!getEncrypted('openai_key') })))
app.post('/api/settings/openai', wrap((req, res) => {
  setEncrypted('openai_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))

// Musiques de fond (libres de droits) pour les vidéos IA
const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, musicDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
})
app.get('/api/music', wrap((_req, res) => res.json({ tracks: musicTracks() })))
app.post('/api/music', musicUpload.single('file'), wrap((req, res) => {
  const f = (req as Request & { file?: Express.Multer.File }).file
  if (!f) return res.status(400).json({ error: 'Fichier manquant' })
  res.json({ ok: true })
}))
app.delete('/api/music/:name', wrap((req, res) => {
  const p = join(musicDir, basename(req.params.name))
  if (existsSync(p)) rmSync(p)
  res.json({ ok: true })
}))
app.get('/api/trends', wrap(async (_req, res) => {
  const key = getEncrypted('rapidapi_key')
  const host = repo.getSetting('trends_host') || 'tiktok-trending-data.p.rapidapi.com'
  const path = repo.getSetting('trends_path') || ''
  if (!key || !path) return res.json({ configured: false, hashtags: [] })
  try {
    const hashtags = await fetchTikTokTrends(key, host, path)
    res.json({ configured: true, hashtags })
  } catch (e) {
    res.json({ configured: false, hashtags: [], error: String((e as Error)?.message ?? e) })
  }
}))

// Réglages génériques
app.get('/api/settings/flag/:key', wrap((req, res) => res.json({ value: repo.getSetting(req.params.key) })))
app.post('/api/settings/flag', wrap((req, res) => {
  repo.setSetting(String(req.body?.key), String(req.body?.value ?? ''))
  res.json({ ok: true })
}))

// Clé API Anthropic
app.get('/api/settings/apikey', wrap((_req, res) => res.json({ has: hasApiKey(), masked: getApiKeyMasked() })))
app.post('/api/settings/apikey', wrap((req, res) => {
  setApiKey(String(req.body?.key ?? ''))
  res.json({ ok: true })
}))
app.delete('/api/settings/apikey', wrap((_req, res) => {
  clearApiKey()
  res.json({ ok: true })
}))
app.get('/api/settings/validate', wrap(async (_req, res) => {
  const key = getApiKey()
  const masked = getApiKeyMasked()
  if (!key) return res.json({ connected: false, masked: null })
  try {
    await new Anthropic({ apiKey: key }).models.list()
    res.json({ connected: true, masked })
  } catch (e) {
    res.json({ connected: false, masked, error: String((e as Error)?.message ?? e) })
  }
}))
app.get('/api/settings/spend', wrap((_req, res) =>
  res.json({
    usd: parseFloat(repo.getSetting(SPEND_USD) ?? '0') || 0,
    inTokens: parseInt(repo.getSetting(SPEND_IN) ?? '0', 10) || 0,
    outTokens: parseInt(repo.getSetting(SPEND_OUT) ?? '0', 10) || 0
  })
))
app.post('/api/settings/spend/reset', wrap((_req, res) => {
  repo.setSetting(SPEND_USD, '0')
  repo.setSetting(SPEND_IN, '0')
  repo.setSetting(SPEND_OUT, '0')
  res.json({ ok: true })
}))

// Clé Groq
app.get('/api/settings/groq', wrap((_req, res) => res.json({ has: !!getEncrypted('groq_key') })))
app.post('/api/settings/groq', wrap((req, res) => {
  setEncrypted('groq_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))

// Clé RapidAPI (téléchargement vidéo côté serveur, contourne le blocage YouTube)
app.get('/api/settings/rapidapi', wrap((_req, res) => res.json({ has: !!getEncrypted('rapidapi_key') })))
app.post('/api/settings/rapidapi', wrap((req, res) => {
  setEncrypted('rapidapi_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))

// Clé API upload-post (publication TikTok publique via agrégateur audité)
app.get('/api/settings/uploadpost', wrap((_req, res) => res.json({ has: !!getEncrypted('uploadpost_key') })))
app.post('/api/settings/uploadpost', wrap((req, res) => {
  setEncrypted('uploadpost_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))
// Profils upload-post (multi-comptes) : liste les comptes TikTok connectés côté upload-post
app.get('/api/uploadpost/profiles', wrap(async (_req, res) => {
  const key = getEncrypted('uploadpost_key')
  if (!key) return res.status(400).json({ error: 'Clé API upload-post manquante' })
  res.json({ profiles: await listUploadPostProfiles(key) })
}))

// yt-dlp
app.post('/api/ytdlp/update', wrap(async (_req, res) => {
  await updateYtDlp(paths.bin, emitLog)
  res.json({ ok: true })
}))
app.post('/api/ytdlp/install-pot', wrap(async (_req, res) => {
  await installPotPlugin(paths.bin, emitLog)
  res.json({ ok: true })
}))

// Scheduler
app.post('/api/scheduler/reload', wrap((_req, res) => {
  reloadScheduler()
  res.json({ ok: true })
}))
app.get('/api/scheduler/status', wrap((_req, res) => {
  const enabled = repo.getSetting('schedule_enabled') === '1'
  const paused = repo.getSetting('queue_paused') === '1'
  const cron = repo.getSetting('schedule_cron') || '*/30 * * * *'
  const lastRunAt = Number(repo.getSetting('schedule_last_run')) || null
  let nextRunAt: number | null = null
  let intervalSec: number | null = null
  if (enabled && !paused) {
    const n1 = cronNext(cron, new Date())
    if (n1) {
      nextRunAt = n1.getTime()
      const n2 = cronNext(cron, n1)
      if (n2) intervalSec = Math.round((n2.getTime() - n1.getTime()) / 1000)
    }
  }
  res.json({ enabled, paused, cron, nextRunAt, intervalSec, lastRunAt })
}))

// TikTok
app.get('/api/tiktok/status', wrap((_req, res) =>
  res.json({
    connected: tiktokConnected(),
    hasConfig: !!getTikTokConfig(),
    hasSecret: !!getEncrypted('tiktok_client_secret')
  })
))
app.get('/api/tiktok/profile', wrap((_req, res) => res.json(getTikTokProfile())))
app.get('/api/tiktok/authurl', wrap((_req, res) => res.json({ url: getTikTokAuthUrl() })))
app.post('/api/tiktok/code', wrap(async (req, res) => {
  await submitTikTokCode(String(req.body?.code ?? ''))
  res.json({ ok: true })
}))
app.post('/api/tiktok/check', wrap(async (_req, res) => res.json(await checkTikTokCreator())))
app.post('/api/tiktok/secret', wrap((req, res) => {
  setEncrypted('tiktok_client_secret', String(req.body?.secret ?? ''))
  res.json({ ok: true })
}))
app.post('/api/tiktok/disconnect', wrap((_req, res) => {
  clearTikTokTokens()
  res.json({ ok: true })
}))

// Médias (clips) — statiques protégés
app.use('/media/clips', express.static(paths.clips))

// Front web (build Vite) — servi en dernier
const webDir = join(process.cwd(), 'dist-web')
if (existsSync(webDir)) {
  app.use(express.static(webDir))
  app.get(/^(?!\/(api|media)\/).*/, (_req, res) => res.sendFile(join(webDir, 'index.html')))
}

app.listen(config.port, () => {
  console.log(`TikTokClip server → http://localhost:${config.port}`)
})
