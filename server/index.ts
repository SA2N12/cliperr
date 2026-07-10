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
import { generateVideoFromIdea, chooseMusicTrack, genImageGemini } from './video-gen'
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
import { generateViralIdeas, generateEpisodeIdea, fetchTikTokTrends, type SeriesState } from './ideas'
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
  activeProfile,
  activeScope,
  profileCtas
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

/**
 * Modèle utilisé pour l'ÉCRITURE (idées, épisodes de série, storyboards).
 * Réglé via `script_model` (éco/équilibré/max) — indépendant du modèle du
 * pipeline de clipping (`highlights_model`), avec repli dessus.
 */
function scriptModel(): string {
  const pick = repo.getSetting('script_model') || repo.getSetting(FLAG_MODEL) || 'haiku'
  return MODEL_MAP[pick] ?? MODEL_MAP.haiku
}

// Tendances TikTok (RapidAPI) mises en cache 6 h — vide si l'API n'est pas configurée.
let trendsCache: { at: number; tags: string[] } | null = null
async function getTrendsCached(): Promise<string[]> {
  if (trendsCache && Date.now() - trendsCache.at < 6 * 60 * 60 * 1000) return trendsCache.tags
  const key = getEncrypted('rapidapi_key')
  const host = repo.getSetting('trends_host') || 'tiktok-trending-data.p.rapidapi.com'
  const path = repo.getSetting('trends_path') || ''
  if (!key || !path) return []
  try {
    const tags = await fetchTikTokTrends(key, host, path)
    trendsCache = { at: Date.now(), tags }
    return tags
  } catch {
    return trendsCache?.tags ?? []
  }
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
async function runVideoGen(
  ideaId: number,
  opts: { profile?: string; autoPublish?: boolean; imageStyle?: string; characterRefPath?: string; animateScenes?: boolean; dialogue?: boolean; noMusic?: boolean } = {}
): Promise<number | null> {
  const idea = repo.getIdea(ideaId)
  if (!idea) return null
  const targetProfile = (opts.profile || activeProfile()).trim()
  const anthropicKey = getApiKey()
  const openaiKey = getEncrypted('openai_key')
  if (!anthropicKey) { emitIdeaVideo({ ideaId, status: 'error', message: 'Clé Claude manquante (Réglages).' }); return null }
  if (!openaiKey) { emitIdeaVideo({ ideaId, status: 'error', message: 'Clé OpenAI manquante (Réglages).' }); return null }
  const model = scriptModel()
  try {
    emitIdeaVideo({ ideaId, status: 'running', message: 'Démarrage…' })
    const ctx = await getContext()
    const tracks = musicTracks()
    let musicTrack: string | undefined
    if (tracks.length && !opts.noMusic) {
      emitIdeaVideo({ ideaId, status: 'running', message: 'Choix de la musique (IA)…' })
      // Évite de rejouer le dernier morceau utilisé sur ce compte (variété).
      const lastKey = `music_last_${targetProfile}`
      const exclude = repo.getSetting(lastKey)
      const chosen = await chooseMusicTrack(anthropicKey, model, idea, tracks, exclude)
      if (chosen) {
        musicTrack = join(musicDir, chosen)
        repo.setSetting(lastKey, chosen)
        emitIdeaVideo({ ideaId, status: 'running', message: `Musique : ${chosen.replace(/^[a-z]+-\d+-/, '').replace(/\.[^.]+$/, '')}` })
      }
    }
    const { filePath, durationSec, usage } = await generateVideoFromIdea(ctx, {
      anthropicKey,
      anthropicModel: model,
      openaiKey,
      voice: repo.getSetting('tts_voice') || 'onyx',
      idea,
      musicTrack,
      imageStyle: opts.imageStyle,
      geminiKey: getEncrypted('gemini_key'),
      characterRefPath: opts.characterRefPath,
      falKey: getEncrypted('fal_key'),
      falVideoModel: repo.getSetting('fal_video_model') || undefined,
      animateScenes: opts.animateScenes,
      dialogue: opts.dialogue,
      videoEngine: repo.getSetting('series_video_engine') || 'seedance',
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
      profile: targetProfile
    })
    // NB : en autopilot on publie par ID juste après (pas besoin d'approuver
    // avant — ça éviterait aussi qu'un échec laisse un clip « approuvé non publié »
    // récupérable par le scheduler manuel et posté sur le mauvais compte).
    if (repo.getSetting('auto_approve') === '1') repo.setClipReview(clip.id, 'approved')
    emitIdeaVideo({ ideaId, status: 'done', message: 'Vidéo prête ✅' })
    if (opts.autoPublish) {
      emitIdeaVideo({ ideaId, status: 'running', message: `Publication sur « ${targetProfile} »…` })
      await publishClipById(clip.id, paths, emitLog, { uploadPostUser: targetProfile })
      emitIdeaVideo({ ideaId, status: 'done', message: `Publié sur « ${targetProfile} » ✅` })
    }
    return clip.id
  } catch (e) {
    emitIdeaVideo({ ideaId, status: 'error', message: e instanceof Error ? e.message : String(e) })
    return null
  }
}

// ── Pilote automatique : chaque jour, du contenu adapté par compte (niche) ──
// Config (settings) :
//   autopilot_enabled = '1' | '0'
//   autopilot_per_day = nombre de vidéos/jour/compte (défaut 1)
//   autopilot_niches  = JSON { [username]: niche }
// Idempotence : autopilot_count_<user>_<YYYY-MM-DD> = nb déjà produit aujourd'hui.
const DEFAULT_NICHES = [
  'Histoires effrayantes et mystères non résolus',
  'Sport : moments légendaires, records et anecdotes qui marquent (foot, NBA, JO, boxe, F1…)',
  'Développement personnel et motivation',
  'Anecdotes historiques méconnues',
  'Psychologie et astuces mentales du quotidien'
]
// Fenêtre de publication en heure de Paris : on ne poste qu'entre ces heures,
// et on LISSE la production sur toute la fenêtre (sinon tout part d'un coup à la
// remise à zéro des compteurs à minuit → publication uniquement la nuit).
const PUB_START_HOUR = 9
const PUB_END_HOUR = 23
/** Heure locale (Europe/Paris) sous forme entière + fractionnaire (heures.décimales). */
function parisClock(): { hour: number; hm: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { hour, hm: hour + minute / 60 }
}
/** Date du jour (Europe/Paris, YYYY-MM-DD) → clé des compteurs quotidiens. */
function dayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}
/** Décompose un timestamp en date/heure Paris (pour dater les vidéos déjà publiées). */
function parisPartsOf(ms: number): { date: string; hm: number; label: string } {
  const dt = new Date(ms)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(dt)
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(dt)
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0') % 24
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? '0')
  return { date, hm: h + m / 60, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
}
function autopilotNiches(): Record<string, string> {
  try {
    const raw = repo.getSetting('autopilot_niches')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
/** Niche configurée pour un compte, avec repli sur une niche par défaut (assignée par ordre). */
function nicheForProfile(user: string): string {
  const map = autopilotNiches()
  const explicit = (map[user] || '').trim()
  if (explicit) return explicit
  const idx = uploadPostProfiles().indexOf(user)
  return DEFAULT_NICHES[((idx < 0 ? 0 : idx) % DEFAULT_NICHES.length)]
}

// ── Mode série (feuilleton) par compte : autopilot_series = { [user]: SeriesState } ──
function autopilotSeries(): Record<string, SeriesState> {
  try {
    const raw = repo.getSetting('autopilot_series')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, SeriesState>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
// ── Créneaux personnalisés du jour : heure et/ou type choisis PAR VIDÉO.
// autopilot_slot_overrides = { [YYYY-MM-DD]: { "<user>:<ordinal>": { hm?, type?, subject? } } }
// (on ne conserve que le jour courant ; type: 'niche' | 'serie' | 'custom')
type SlotOverride = { hm?: number; type?: string; subject?: string }
function slotOverrides(): Record<string, Record<string, SlotOverride>> {
  try {
    const raw = repo.getSetting('autopilot_slot_overrides')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, Record<string, SlotOverride>>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
/** Série CONFIGURÉE (titre + univers remplis), même si le toggle est désactivé — pour forcer un épisode sur un créneau. */
function seriesConfiguredFor(user: string): SeriesState | null {
  const s = autopilotSeries()[user]
  if (!s || !(s.title || '').trim() || !(s.universe || '').trim()) return null
  return {
    enabled: !!s.enabled,
    title: s.title.trim(),
    universe: s.universe.trim(),
    episode: Math.max(1, Number(s.episode) || 1),
    recap: (s.recap || '').trim()
  }
}

// ── Cadence par compte : autopilot_per_day_map = { [user]: 0..5 } (0 = en pause).
// Repli sur le réglage global `autopilot_per_day` ; les séries sont plafonnées à 1/jour.
function perDayMap(): Record<string, number> {
  try {
    const raw = repo.getSetting('autopilot_per_day_map')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, number>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
function perDayForProfile(user: string): number {
  const globalPerDay = Math.max(1, Number(repo.getSetting('autopilot_per_day')) || 1)
  const raw = perDayMap()[user]
  return raw == null ? globalPerDay : Math.max(0, Math.min(5, Math.round(Number(raw)) || 0))
}

/** Après un épisode publié : incrémente le compteur et enregistre la mémoire de l'histoire. */
function advanceSeries(user: string, recap: string): void {
  const map = autopilotSeries()
  const s = map[user]
  if (!s) return
  map[user] = { ...s, episode: Math.max(1, Number(s.episode) || 1) + 1, recap: recap.slice(0, 600) }
  repo.setSetting('autopilot_series', JSON.stringify(map))
}

// Planche de référence des personnages (Nano Banana) : générée à l'épisode 1,
// réutilisée ensuite pour garder des personnages IDENTIQUES d'un épisode à l'autre.
const seriesRefDir = join(paths.data, 'series-refs')
async function ensureSeriesRef(user: string, series: SeriesState, geminiKey: string): Promise<string | undefined> {
  try {
    mkdirSync(seriesRefDir, { recursive: true })
    const p = join(seriesRefDir, `${user}.png`)
    if (series.episode > 1 && existsSync(p)) return p
    emitLog(`Pilote auto : planche des personnages « ${series.title} » (Nano Banana)…`)
    await genImageGemini(
      geminiKey,
      `Character reference sheet showing ALL the recurring characters of this series together, full body, clearly separated on a neutral background, consistent art style: ${series.universe}. Vivid saturated colors, expressive faces, high detail, no text, no watermark.`,
      p
    )
    return p
  } catch (e) {
    emitLog(`Pilote auto : planche personnages impossible (${e instanceof Error ? e.message : String(e)}) — génération sans référence.`)
    return undefined
  }
}

let autopilotBusy = false
let autopilotTask: ScheduledTask | null = null

/** Un cycle : choisit le compte le PLUS EN RETARD (round-robin) et lui produit + publie 1 vidéo. */
async function runAutopilotTick(force = false): Promise<void> {
  if (!force && repo.getSetting('autopilot_enabled') !== '1') return
  if (autopilotBusy) return
  if (repo.getSetting('queue_paused') === '1') return
  const today = dayKey()
  const profiles = uploadPostProfiles()
  if (!profiles.length) return
  // Quota du jour PAR COMPTE (réglable individuellement ; séries plafonnées à 1/jour).
  const perDayFor = perDayForProfile
  const ovToday = slotOverrides()[today] ?? {}
  const { hm: nowHm } = parisClock()
  const quotaOk = (u: string): boolean => {
    const ts = Number(repo.getSetting(`quota_reached_${u}`)) || 0
    return !(ts && Date.now() - ts < 6 * 60 * 60 * 1000)
  }
  const doneOf = (u: string): number => Number(repo.getSetting(`autopilot_count_${u}_${today}`)) || 0

  // ── Créneau ÉPINGLÉ arrivé à échéance ? (heure choisie à la main sur un bloc
  // du planning — prioritaire sur le lissage, et valable même hors fenêtre 9h-23h)
  let picked: { user: string; done: number } | null = null
  if (!force) {
    let bestHm = Infinity
    for (const u of profiles) {
      if (!quotaOk(u)) continue
      const d = doneOf(u)
      if (d >= perDayFor(u)) continue
      const o = ovToday[`${u}:${d + 1}`]
      if (o?.hm != null && o.hm <= nowHm && o.hm < bestHm) {
        picked = { user: u, done: d }
        bestHm = o.hm
      }
    }
  }

  if (!picked) {
    // ── Lissage horaire (ignoré en mode test « force ») ──
    // On ne poste que dans la fenêtre Paris, et on étale : à un instant t, on
    // n'a le droit d'avoir produit que « part de la fenêtre écoulée × objectif ».
    if (!force) {
      if (nowHm < PUB_START_HOUR || nowHm >= PUB_END_HOUR) return
      const windowLen = PUB_END_HOUR - PUB_START_HOUR
      const target = profiles.reduce((s, u) => s + perDayFor(u), 0)
      const producedToday = profiles.reduce((s, u) => s + doneOf(u), 0)
      const expected = Math.ceil(((nowHm - PUB_START_HOUR) / windowLen) * target)
      if (producedToday >= expected) return // en avance sur le planning → on attend
    }

    // Comptes éligibles (pas saturés, pas au quota, pas épinglés pour plus tard).
    const eligible: { user: string; done: number }[] = []
    for (const user of profiles) {
      if (!quotaOk(user)) continue
      const done = doneOf(user)
      if (done >= perDayFor(user)) continue
      // Le prochain créneau de ce compte a une heure choisie plus tard → on attend.
      const o = ovToday[`${user}:${done + 1}`]
      if (!force && o?.hm != null && o.hm > nowHm) continue
      eligible.push({ user, done })
    }
    if (!eligible.length) return
    // Round-robin : on sert d'abord le compte qui a le MOINS publié aujourd'hui.
    eligible.sort((a, b) => a.done - b.done)
    picked = eligible[0]
  }

  const { user, done } = picked
  const slotOv = ovToday[`${user}:${done + 1}`] ?? {}
  const niche = nicheForProfile(user)
  const countKey = `autopilot_count_${user}_${today}`

  autopilotBusy = true
  try {
    const anthropicKey = getApiKey()
    if (!anthropicKey) { emitLog('Pilote auto : clé Claude manquante.'); return }
    const model = scriptModel()
    // Tendances TikTok du moment (si l'API est configurée) → scénarios ancrés sur l'actu.
    const trends = await getTrendsCached()

    // Type du créneau : par défaut vidéo de niche ; « Épisode de série » ou
    // « Sujet libre » se choisissent explicitement sur le bloc du planning.
    const subject = (slotOv.subject ?? '').trim()
    const series: SeriesState | null = slotOv.type === 'serie' ? seriesConfiguredFor(user) : null

    let idea: import('./ideas').ViralIdea
    let ideaLabel = niche
    let nextRecap: string | null = null
    let refPath: string | undefined
    if (series) {
      emitLog(`Pilote auto : « ${series.title} » — épisode ${series.episode} pour « ${user} »…`)
      const r = await generateEpisodeIdea({ apiKey: anthropicKey, model, series, trends })
      if (r.usage) addSpend(model, r.usage)
      idea = r.idea
      ideaLabel = `Série : ${series.title}`
      nextRecap = r.recap
      const geminiKey = getEncrypted('gemini_key')
      if (geminiKey) refPath = await ensureSeriesRef(user, series, geminiKey)
    } else {
      const topic = slotOv.type === 'custom' && subject ? subject : niche
      emitLog(`Pilote auto : génération pour « ${user} » (${slotOv.type === 'custom' && subject ? 'sujet : ' : 'niche : '}${topic})…`)
      const { ideas, usage } = await generateViralIdeas({ apiKey: anthropicKey, model, niche: topic, count: 1, trends })
      if (usage) addSpend(model, usage)
      if (!ideas.length) { emitLog(`Pilote auto : aucune idée générée pour « ${user} ».`); return }
      idea = ideas[0]
      if (slotOv.type === 'custom' && subject) ideaLabel = subject
    }

    const saved = repo.createIdea(ideaLabel, idea)
    // On passe par videoChain pour ne jamais monter deux vidéos en parallèle.
    const job = videoChain.then(() =>
      runVideoGen(saved.id, {
        profile: user,
        autoPublish: true,
        imageStyle: series?.universe,
        characterRefPath: refPath,
        animateScenes: !!series, // séries = scènes animées (fal.ai) si la clé est configurée
        dialogue: !!series, // séries = les personnages parlent (voix par personnage)
        noMusic: !!series // séries = pas de musique de fond (dialogues seuls)
      })
    )
    videoChain = job.then(() => undefined, () => undefined)
    const clipId = await job.catch(() => null)
    if (clipId) {
      repo.setSetting(countKey, String(done + 1))
      if (series && nextRecap != null) advanceSeries(user, nextRecap) // mémoire + épisode suivant
      emitLog(`Pilote auto : vidéo publiée sur « ${user} » (${done + 1}/${perDayFor(user)} aujourd'hui).`)
    } else {
      emitLog(`Pilote auto : échec pour « ${user} » (voir journaux).`)
    }
  } catch (e) {
    emitLog(`Pilote auto : erreur pour « ${user} » — ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    autopilotBusy = false
  }
}

function reloadAutopilot(): void {
  if (autopilotTask) {
    autopilotTask.stop()
    autopilotTask = null
  }
  if (repo.getSetting('autopilot_enabled') !== '1') return
  // Toutes les 15 min : au plus 1 vidéo/cycle, en round-robin sur les comptes,
  // et lissée sur la fenêtre 9h-23h (Paris) → publication étalée sur la journée.
  const expr = repo.getSetting('autopilot_cron') || '*/15 * * * *'
  if (!cron.validate(expr)) return
  autopilotTask = cron.schedule(expr, () => {
    void runAutopilotTick().catch((e) => emitLog(`Pilote auto : ${e instanceof Error ? e.message : String(e)}`))
  })
  emitLog(`Pilote auto activé (cron « ${expr} »).`)
}

// ── Bootstrap ──
assertConfig()
for (const dir of [paths.downloads, paths.clips, paths.bin, paths.models, paths.uploads, musicDir]) {
  mkdirSync(dir, { recursive: true })
}
initDb(paths.data)
reloadScheduler()
reloadAutopilot()

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
  const model = scriptModel()
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
  res.json({ mode, profiles, active, scope: activeScope(), quotaReached, quotaProfile: quotaReached ? active : null })
}))

// Tableau de bord des perfs : analytics TikTok par compte (via upload-post)
interface ProfileAnalytics {
  profile: string
  handle: string | null
  avatarUrl: string | null
  followers: number
  views: number
  likes: number
  comments: number
  shares: number
  videoCount: number
  timeseries: { date: string; value: number }[]
}
let analyticsCache: { at: number; data: ProfileAnalytics[] } | null = null
async function fetchTikTokAnalytics(key: string, profile: string): Promise<Partial<ProfileAnalytics>> {
  try {
    const r = await fetch(`https://api.upload-post.com/api/analytics/${encodeURIComponent(profile)}?platforms=tiktok`, {
      headers: { Authorization: `Apikey ${key}` }
    })
    if (!r.ok) return {}
    const j = (await r.json()) as {
      tiktok?: {
        followers?: number
        impressions?: number
        likes?: number
        comments?: number
        shares?: number
        video_count?: number
        reach_timeseries?: { date: string; value: number }[]
      }
    }
    const t = j.tiktok
    if (!t) return {}
    return {
      followers: t.followers || 0,
      views: t.impressions || 0,
      likes: t.likes || 0,
      comments: t.comments || 0,
      shares: t.shares || 0,
      videoCount: t.video_count || 0,
      timeseries: (t.reach_timeseries || []).map((p) => ({ date: p.date, value: p.value || 0 }))
    }
  } catch {
    return {}
  }
}
app.get('/api/analytics', wrap(async (_req, res) => {
  const key = getEncrypted('uploadpost_key')
  if (!key) return res.json({ profiles: [] })
  if (analyticsCache && Date.now() - analyticsCache.at < 10 * 60 * 1000) return res.json({ profiles: analyticsCache.data })
  const profs = uploadPostProfiles()
  const all = await cachedUploadPostProfiles()
  const byName = new Map(all.map((p) => [p.username, p]))
  const data: ProfileAnalytics[] = []
  for (const p of profs) {
    const a = await fetchTikTokAnalytics(key, p)
    const meta = byName.get(p)
    data.push({
      profile: p,
      handle: meta?.tiktokHandle ?? null,
      avatarUrl: meta?.avatarUrl ?? null,
      followers: a.followers ?? 0,
      views: a.views ?? 0,
      likes: a.likes ?? 0,
      comments: a.comments ?? 0,
      shares: a.shares ?? 0,
      videoCount: a.videoCount ?? 0,
      timeseries: a.timeseries ?? []
    })
  }
  analyticsCache = { at: Date.now(), data }
  res.json({ profiles: data })
}))

// Analytics par vidéo (pour les vidéos publiées via Cliperr, dont on connaît l'ID)
async function fetchPostAnalytics(key: string, user: string, postId: string): Promise<{ views: number; likes: number; comments: number; shares: number } | null> {
  try {
    const r = await fetch(
      `https://api.upload-post.com/api/uploadposts/post-analytics?user=${encodeURIComponent(user)}&platform_post_id=${encodeURIComponent(postId)}&platform=tiktok`,
      { headers: { Authorization: `Apikey ${key}` } }
    )
    if (!r.ok) return null
    const j = (await r.json()) as { platforms?: { tiktok?: { post_metrics?: { views?: number; likes?: number; comments?: number; shares?: number } } } }
    const m = j.platforms?.tiktok?.post_metrics
    if (!m) return null
    return { views: m.views || 0, likes: m.likes || 0, comments: m.comments || 0, shares: m.shares || 0 }
  } catch {
    return null
  }
}
const postsCache = new Map<string, { at: number; posts: unknown[] }>()
app.get('/api/analytics/posts', wrap(async (req, res) => {
  const profile = String(req.query.profile ?? '')
  const key = getEncrypted('uploadpost_key')
  if (!profile || !key) return res.json({ posts: [] })
  const cached = postsCache.get(profile)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return res.json({ posts: cached.posts })
  const clips = repo
    .listClips()
    .filter((c) => c.publishedAccount === profile && c.postId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
  const posts = []
  for (const c of clips) {
    const m = await fetchPostAnalytics(key, profile, c.postId as string)
    posts.push({
      clipId: c.id,
      title: c.title,
      filePath: c.filePath,
      postUrl: c.postUrl,
      createdAt: c.createdAt,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
      shares: m?.shares ?? 0
    })
  }
  postsCache.set(profile, { at: Date.now(), posts })
  res.json({ posts })
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

// Clé Gemini / Nano Banana (personnages cohérents pour le mode série)
app.get('/api/settings/gemini', wrap((_req, res) => res.json({ has: !!getEncrypted('gemini_key') })))
app.post('/api/settings/gemini', wrap((req, res) => {
  setEncrypted('gemini_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))

// Clé fal.ai (animation vidéo des scènes de série : image → clip animé)
app.get('/api/settings/fal', wrap((_req, res) => res.json({ has: !!getEncrypted('fal_key') })))
app.post('/api/settings/fal', wrap((req, res) => {
  setEncrypted('fal_key', String(req.body?.key ?? ''))
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

// Pilote automatique : contenu quotidien par compte selon sa niche
app.get('/api/autopilot', wrap(async (_req, res) => {
  const profiles = uploadPostProfiles()
  const meta = new Map((await cachedUploadPostProfiles()).map((p) => [p.username, p]))
  const today = dayKey()
  const niches = autopilotNiches()
  const ctas = profileCtas()
  const seriesMap = autopilotSeries()
  const globalPerDay = Math.max(1, Number(repo.getSetting('autopilot_per_day')) || 1)
  const pdMap = perDayMap()
  res.json({
    enabled: repo.getSetting('autopilot_enabled') === '1',
    perDay: globalPerDay,
    busy: autopilotBusy,
    profiles: profiles.map((u) => {
      const s = seriesMap[u]
      return {
        username: u,
        handle: meta.get(u)?.tiktokHandle ?? null,
        avatarUrl: meta.get(u)?.avatarUrl ?? null,
        niche: (niches[u] ?? '').trim() || nicheForProfile(u),
        cta: (ctas[u] ?? '').trim(),
        perDay: pdMap[u] == null ? globalPerDay : Math.max(0, Math.min(5, Math.round(Number(pdMap[u])) || 0)),
        series: {
          enabled: !!s?.enabled,
          title: (s?.title ?? '').trim(),
          universe: (s?.universe ?? '').trim(),
          episode: Math.max(1, Number(s?.episode) || 1)
        },
        doneToday: Number(repo.getSetting(`autopilot_count_${u}_${today}`)) || 0
      }
    })
  })
}))
app.post('/api/autopilot', wrap((req, res) => {
  const b = (req.body ?? {}) as { enabled?: unknown; perDay?: unknown; perDays?: unknown; niches?: unknown; ctas?: unknown; series?: unknown }
  const wasEnabled = repo.getSetting('autopilot_enabled') === '1'
  if (typeof b.enabled === 'boolean') repo.setSetting('autopilot_enabled', b.enabled ? '1' : '0')
  if (b.perDay != null) repo.setSetting('autopilot_per_day', String(Math.max(1, Math.min(5, Math.round(Number(b.perDay)) || 1))))
  if (b.perDays && typeof b.perDays === 'object') {
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(b.perDays as Record<string, unknown>)) {
      const n = Math.round(Number(v))
      if (Number.isFinite(n)) clean[k] = Math.max(0, Math.min(5, n))
    }
    repo.setSetting('autopilot_per_day_map', JSON.stringify(clean))
  }
  if (b.niches && typeof b.niches === 'object') {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(b.niches as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim()
    }
    repo.setSetting('autopilot_niches', JSON.stringify(clean))
  }
  if (b.ctas && typeof b.ctas === 'object') {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(b.ctas as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim().slice(0, 220)
    }
    repo.setSetting('profile_ctas', JSON.stringify(clean))
  }
  if (b.series && typeof b.series === 'object') {
    const cur = autopilotSeries()
    const next: Record<string, SeriesState> = {}
    for (const [k, v] of Object.entries(b.series as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const s = v as { enabled?: unknown; title?: unknown; universe?: unknown }
      const title = typeof s.title === 'string' ? s.title.trim().slice(0, 120) : ''
      const universe = typeof s.universe === 'string' ? s.universe.trim().slice(0, 600) : ''
      const enabled = s.enabled === true
      if (!title && !universe && !enabled) continue
      // Nouveau titre = nouvelle histoire → on repart à l'épisode 1, mémoire vide.
      const prev = cur[k]
      const isNewStory = !prev || prev.title !== title
      next[k] = {
        enabled,
        title,
        universe,
        episode: isNewStory ? 1 : Math.max(1, Number(prev.episode) || 1),
        recap: isNewStory ? '' : prev.recap || ''
      }
    }
    repo.setSetting('autopilot_series', JSON.stringify(next))
  }
  reloadAutopilot()
  // Passage OFF → ON : on lance tout de suite un premier cycle (1 vidéo),
  // puis le rythme horaire prend le relais.
  const nowEnabled = repo.getSetting('autopilot_enabled') === '1'
  if (!wasEnabled && nowEnabled) {
    emitLog('Pilote auto activé : premier cycle immédiat…')
    void runAutopilotTick().catch((e) => emitLog(`Pilote auto : ${e instanceof Error ? e.message : String(e)}`))
  }
  res.json({ ok: true })
}))
// Lance immédiatement un cycle (test) : produit + publie 1 vidéo pour le 1er compte sous quota.
app.post('/api/autopilot/run-now', wrap((_req, res) => {
  void runAutopilotTick(true).catch((e) => emitLog(`Pilote auto : ${e instanceof Error ? e.message : String(e)}`))
  res.json({ ok: true })
}))
// Planning du jour : vidéos DÉJÀ publiées (heure réelle) + À VENIR (estimées de
// maintenant jusqu'à la fin de la fenêtre, dans l'ordre round-robin du pilote).
app.get('/api/autopilot/plan', wrap(async (_req, res) => {
  const enabled = repo.getSetting('autopilot_enabled') === '1'
  const perDay = Math.max(1, Number(repo.getSetting('autopilot_per_day')) || 1)
  const profiles = uploadPostProfiles()
  const n = profiles.length
  const { hm: nowHm } = parisClock()
  const win = { start: PUB_START_HOUR, end: PUB_END_HOUR }
  if (!n) return res.json({ enabled, perDay, window: win, nowHm, slots: [] })
  const meta = new Map((await cachedUploadPostProfiles()).map((p) => [p.username, p]))
  const today = dayKey()
  const fmt = (h: number): string => {
    let hh = Math.floor(h)
    let mm = Math.round((h - hh) * 60)
    if (mm === 60) { hh += 1; mm = 0 }
    return `${String(hh).padStart(2, '0')}:${String(Math.max(0, mm)).padStart(2, '0')}`
  }
  type Slot = {
    user: string
    handle: string | null
    avatarUrl: string | null
    niche: string
    ordinal: number
    etaHm: number
    eta: string
    done: boolean
    pinned?: boolean
    type?: string
    subject?: string
    hasSeries?: boolean
  }
  const slots: Slot[] = []
  const ovToday = slotOverrides()[today] ?? {}

  // Heures RÉELLES + titres des vidéos publiées aujourd'hui, par compte.
  const doneTimes = new Map<string, { at: number; title: string | null }[]>()
  for (const c of repo.listClips()) {
    if (c.publishStatus !== 'published' || !c.profile) continue
    if (parisPartsOf(c.createdAt).date !== today) continue
    const arr = doneTimes.get(c.profile) ?? []
    arr.push({ at: c.createdAt, title: c.title })
    doneTimes.set(c.profile, arr)
  }
  for (const arr of doneTimes.values()) arr.sort((a, b) => a.at - b.at)

  const remaining = new Map<string, number>()
  profiles.forEach((user) => {
    const done = Number(repo.getSetting(`autopilot_count_${user}_${today}`)) || 0
    const m = meta.get(user)
    const info = {
      user,
      handle: m?.tiktokHandle ?? null,
      avatarUrl: m?.avatarUrl ?? null,
      niche: nicheForProfile(user)
    }
    const times = doneTimes.get(user) ?? []
    for (let j = 1; j <= done; j++) {
      const t = times[j - 1]
      const pp = t ? parisPartsOf(t.at) : null
      // Pour les publiées : on affiche le TITRE RÉEL de la vidéo (pas la config
      // actuelle du compte, qui a pu changer depuis — ex. passage en mode série).
      slots.push({
        ...info,
        niche: t?.title || info.niche,
        ordinal: j,
        etaHm: pp ? pp.hm : 0,
        eta: pp ? pp.label : '—',
        done: true
      })
    }
    // Quota individuel par compte (séries plafonnées à 1 épisode/jour).
    remaining.set(user, Math.max(0, perDayForProfile(user) - done))
  })

  // À venir : étalées régulièrement de maintenant → fin de fenêtre, en servant
  // à chaque pas le compte le PLUS en retard (même logique que le pilote).
  let remainingTotal = 0
  for (const v of remaining.values()) remainingTotal += v
  const winStart = Math.min(PUB_END_HOUR, Math.max(nowHm, PUB_START_HOUR))
  const step = remainingTotal > 0 ? (PUB_END_HOUR - winStart) / remainingTotal : 0
  const nextOrdinal = new Map<string, number>()
  profiles.forEach((u) => nextOrdinal.set(u, (Number(repo.getSetting(`autopilot_count_${u}_${today}`)) || 0) + 1))
  for (let i = 0; i < remainingTotal; i++) {
    let best: string | null = null
    let bestRem = 0
    for (const u of profiles) {
      const r = remaining.get(u) ?? 0
      if (r > bestRem) { bestRem = r; best = u }
    }
    if (!best) break
    remaining.set(best, (remaining.get(best) ?? 0) - 1)
    const m = meta.get(best)
    const ordinal = nextOrdinal.get(best) ?? 1
    const ov = ovToday[`${best}:${ordinal}`]
    const confSerie = seriesConfiguredFor(best)
    // Libellé selon le type du créneau (niche par défaut).
    let label: string
    if (ov?.type === 'custom' && (ov.subject ?? '').trim()) label = `Sujet : ${(ov.subject ?? '').trim()}`
    else if (ov?.type === 'serie' && confSerie) label = `Série : ${confSerie.title} — Ép. ${confSerie.episode}`
    else label = nicheForProfile(best)
    const etaHm = ov?.hm != null ? ov.hm : winStart + step * i
    slots.push({
      user: best,
      handle: m?.tiktokHandle ?? null,
      avatarUrl: m?.avatarUrl ?? null,
      niche: label,
      ordinal,
      etaHm,
      eta: fmt(etaHm),
      done: false,
      pinned: ov?.hm != null,
      type: ov?.type,
      subject: ov?.subject,
      hasSeries: !!confSerie
    })
    nextOrdinal.set(best, ordinal + 1)
  }

  slots.sort((a, b) => a.etaHm - b.etaHm)
  const targetPerDay = profiles.reduce((s, u) => s + perDayForProfile(u), 0)
  res.json({ enabled, perDay, targetPerDay, window: win, nowHm, today, slots })
}))
// Réglages d'UN SEUL compte (fusion dans les maps existantes — pas de remplacement
// global) : utilisé par la fenêtre ⚙️ des lignes du planning.
app.post('/api/autopilot/account', wrap((req, res) => {
  const b = (req.body ?? {}) as { user?: unknown; perDay?: unknown; niche?: unknown; cta?: unknown; series?: unknown }
  const user = String(b.user ?? '').trim()
  if (!user || !uploadPostProfiles().includes(user)) return res.status(400).json({ error: 'Compte inconnu' })
  if (b.perDay != null) {
    const m = perDayMap()
    m[user] = Math.max(0, Math.min(5, Math.round(Number(b.perDay)) || 0))
    repo.setSetting('autopilot_per_day_map', JSON.stringify(m))
  }
  if (typeof b.niche === 'string') {
    const m = autopilotNiches()
    if (b.niche.trim()) m[user] = b.niche.trim()
    else delete m[user]
    repo.setSetting('autopilot_niches', JSON.stringify(m))
  }
  if (typeof b.cta === 'string') {
    const m = profileCtas()
    if (b.cta.trim()) m[user] = b.cta.trim().slice(0, 220)
    else delete m[user]
    repo.setSetting('profile_ctas', JSON.stringify(m))
  }
  if (b.series && typeof b.series === 'object') {
    const s = b.series as { enabled?: unknown; title?: unknown; universe?: unknown }
    const map = autopilotSeries()
    const title = typeof s.title === 'string' ? s.title.trim().slice(0, 120) : ''
    const universe = typeof s.universe === 'string' ? s.universe.trim().slice(0, 600) : ''
    const enabled = s.enabled === true
    if (!title && !universe && !enabled) {
      delete map[user]
    } else {
      const prev = map[user]
      const isNewStory = !prev || prev.title !== title
      map[user] = {
        enabled,
        title,
        universe,
        episode: isNewStory ? 1 : Math.max(1, Number(prev.episode) || 1),
        recap: isNewStory ? '' : prev.recap || ''
      }
    }
    repo.setSetting('autopilot_series', JSON.stringify(map))
  }
  res.json({ ok: true })
}))

// Personnalise un créneau du jour (heure et/ou type) — clic sur un bloc du planning.
app.post('/api/autopilot/slot', wrap((req, res) => {
  const b = (req.body ?? {}) as { user?: unknown; ordinal?: unknown; hm?: unknown; type?: unknown; subject?: unknown; reset?: unknown }
  const user = String(b.user ?? '').trim()
  const ordinal = Math.max(1, Math.round(Number(b.ordinal)) || 1)
  if (!user || !uploadPostProfiles().includes(user)) return res.status(400).json({ error: 'Compte inconnu' })
  const today = dayKey()
  const map = slotOverrides()[today] ?? {}
  const key = `${user}:${ordinal}`
  if (b.reset === true) {
    delete map[key]
  } else {
    const o: SlotOverride = { ...map[key] }
    if (b.hm !== undefined) {
      const hm = Number(b.hm)
      if (b.hm === null || !Number.isFinite(hm)) delete o.hm
      else o.hm = Math.max(0, Math.min(23.98, hm))
    }
    if (b.type !== undefined) {
      const t = String(b.type ?? '')
      if (!t || t === 'auto') {
        delete o.type
        delete o.subject
      } else if (['niche', 'serie', 'custom'].includes(t)) {
        o.type = t
      }
    }
    if (b.subject !== undefined) {
      const s = String(b.subject ?? '').trim().slice(0, 200)
      if (s) o.subject = s
      else delete o.subject
    }
    if (o.hm == null && !o.type) delete map[key]
    else map[key] = o
  }
  // On ne conserve que le jour courant (les personnalisations sont journalières).
  repo.setSetting('autopilot_slot_overrides', JSON.stringify({ [today]: map }))
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

// ── Liens courts publics (« lien en bio ») : cliperr.../mystere → lien affilié ──
const GO_KEY = 'golinks'
const GO_SLUG_RE = /^[a-z0-9-]{2,30}$/
const GO_RESERVED = new Set(['api', 'media', 'assets', 'login'])
function goLinks(): Record<string, string> {
  try {
    const raw = repo.getSetting(GO_KEY)
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
// Route PUBLIQUE (pas d'auth) : les visiteurs TikTok ne sont pas connectés.
app.get(/^\/[a-z0-9-]{2,30}$/, (req, res, next) => {
  const url = goLinks()[req.path.slice(1)]
  if (!url) return next()
  res.redirect(302, url)
})
// Gestion (protégée par l'auth /api)
app.get('/api/golinks', wrap((_req, res) => res.json({ links: goLinks() })))
app.post('/api/golinks', wrap((req, res) => {
  const body = (req.body ?? {}) as { links?: unknown }
  const clean: Record<string, string> = {}
  if (body.links && typeof body.links === 'object') {
    for (const [k, v] of Object.entries(body.links as Record<string, unknown>)) {
      const slug = String(k).trim().toLowerCase()
      const url = typeof v === 'string' ? v.trim() : ''
      if (!GO_SLUG_RE.test(slug) || GO_RESERVED.has(slug)) continue
      if (!/^https?:\/\//i.test(url)) continue
      clean[slug] = url
    }
  }
  repo.setSetting(GO_KEY, JSON.stringify(clean))
  res.json({ ok: true, links: clean })
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
