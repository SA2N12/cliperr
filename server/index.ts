import express, { type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import cron, { type ScheduledTask } from 'node-cron'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'

import { appPaths, config, assertConfig, type AppPaths } from './config'
import { handleLogin, handleLogout, isAuthed, requireAuth } from './auth'
import { sseHandler, emitProgress, emitLog } from './sse'
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
  publishClipById
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
  const cookiesFile = repo.getSetting('ytdlp_cookies_file') || null

  repo.updateSource(sourceId, { status: 'running', error: null })
  try {
    const ctx = await getContext()
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
      { id: source.id, url: source.url },
      {
        emit: send,
        onMeta: (m) => repo.updateSource(sourceId, { title: m.title, author: m.author, durationSec: m.durationSec }),
        onSourceFile: (fp) => repo.updateSource(sourceId, { filePath: fp }),
        onClip: (c) =>
          repo.createClip({
            sourceId,
            startSec: c.startSec,
            endSec: c.endSec,
            filePath: c.filePath,
            score: c.score,
            reason: c.reason,
            title: c.title,
            description: c.description,
            hashtags: c.hashtags
          }),
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
      const clip = repo.nextApprovedUnpublished()
      if (!clip) {
        emitLog('Planification : aucun clip validé en attente.')
        return
      }
      try {
        await publishClipById(clip.id, paths, emitLog)
      } catch {
        /* statut déjà "failed" */
      }
    })()
  })
  emitLog(`Planification activée (cron « ${expr} »).`)
}

// ── Bootstrap ──
assertConfig()
for (const dir of [paths.downloads, paths.clips, paths.bin, paths.models, paths.uploads]) {
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
  const job = pipelineChain.then(() => runForSource(sourceId, clipCount))
  pipelineChain = job.then(() => undefined, () => undefined)
  res.json({ ok: true })
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
