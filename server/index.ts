import express, { type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import cron, { type ScheduledTask } from 'node-cron'
import { mkdirSync, existsSync, readdirSync, rmSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import Anthropic from '@anthropic-ai/sdk'

import { appPaths, config, assertConfig, type AppPaths } from './config'
import { handleLogin, handleLogout, isAuthed, requireAuth } from './auth'
import { sseHandler, emitProgress, emitLog, emitIdeaVideo } from './sse'
import { generateVideoFromIdea, chooseMusicTrack, genImageGemini, ttsPreview, listElevenVoices, OPENAI_VOICES } from './video-gen'
import { generateCarousel, assembleSlideshow } from './carousel-gen'
import { uploadPostTikTokPhotos } from '../src/main/publish/uploadpost'
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
import { isLocalFile, fetchMetadata, downloadVideo } from '../src/main/pipeline/ingest'
import { downloadViaApi, isYouTubeUrl, searchYouTubeVideos, probeDownloadable, type SourceMetaApi } from './ytdl-api'
import { listUploadPostProfiles, type UploadPostProfile } from '../src/main/publish/uploadpost'
import { generateViralIdeas, generateEpisodeIdea, generateInspiredIdea, fetchTikTokTrends, type SeriesState } from './ideas'
import { run, type PipelineContext } from '../src/main/pipeline/context'
import { probeDuration } from '../src/main/pipeline/extract'
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
  profileCtas,
  ctaMapForProfile
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

/**
 * Coût estimé d'une vidéo en « crédits » fictifs (~ centimes de $). Sert d'aperçu
 * visuel dans le planning — AUCUN débit réel. Reflète l'ordre de grandeur : un clip
 * (transcription + analyse) < une vidéo simple (images + voix + script) < un épisode
 * de série animée (Nano Banana + fal + Veo).
 */
function estimateCredits(type: string | undefined): number {
  if (type === 'stock') return 0 // clip déjà produit : publier ne coûte rien
  if (type === 'clip') return 15
  if (type === 'carousel' || type === 'slideshow') return 40 // 6 images IA, pas de voix off
  if (type === 'serie') return getEncrypted('fal_key') ? 140 : 70 // fal/Veo, ou repli Ken Burns
  return scriptModel().includes('opus') ? 50 : 45 // vidéo simple (niche / sujet)
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
// yt-dlp cherche son runtime JS (Deno, requis pour résoudre les défis de signature
// YouTube « nsig » — sans quoi YouTube ne renvoie que des images) dans le PATH. On
// y ajoute le dossier des binaires, où vivent yt-dlp ET deno (cf. ensureDeno).
process.env.PATH = `${paths.bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
const musicDir = join(paths.data, 'music')
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|opus)$/i
function musicTracks(): string[] {
  return existsSync(musicDir) ? readdirSync(musicDir).filter((f) => AUDIO_RE.test(f)) : []
}

// profile_voice = { [user]: voix } — voix TTS de la narration, par compte (défaut 'ash').
// Avoir une voix différente par compte diversifie aussi le "son" (anti-détection IA).
function profileVoice(): Record<string, string> {
  try {
    const raw = repo.getSetting('profile_voice')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}

// profile_music = { [user]: string[] } — playlist du compte : les vidéos générées
// piochent dedans À TOUR DE RÔLE (une piste différente à chaque vidéo). Vide =
// l'IA choisit la musique selon l'ambiance (comportement historique).
function profileMusic(): Record<string, string[]> {
  try {
    const raw = repo.getSetting('profile_music')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string[]>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
/**
 * Piste suivante de la playlist d'un compte (rotation persistée via
 * `music_idx_<user>`), ou null si le compte n'a pas de playlist. Les pistes
 * supprimées de /data/music sont ignorées.
 */
function nextMusicForProfile(user: string, available: string[]): string | null {
  const pool = (profileMusic()[user] ?? []).filter((t) => available.includes(t))
  if (!pool.length) return null
  const key = `music_idx_${user}`
  const i = Math.max(0, Number(repo.getSetting(key)) || 0)
  const pick = pool[i % pool.length]
  repo.setSetting(key, String((i + 1) % pool.length))
  return pick
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

async function runForSource(sourceId: number, clipCount: number, profileOverride?: string): Promise<void> {
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

  repo.updateSource(sourceId, { status: 'running', error: null })
  try {
    const ctx = await getContext()

    // Téléchargement YouTube côté serveur. Deux voies :
    //  1) Si des cookies YouTube sont fournis → yt-dlp les utilise (avec le PO
    //     token bgutil) pour passer le « Sign in to confirm you're not a bot ».
    //     C'est la voie fiable : on laisse le pipeline télécharger via yt-dlp.
    //  2) Sinon, repli legacy via RapidAPI (récupère un MP4 puis passe un fichier
    //     LOCAL au pipeline). Note : YouTube verrouille souvent ces liens sur l'IP
    //     de l'API → HTTP 403. Les cookies (voie 1) sont donc à privilégier.
    let effectiveUrl = source.url
    let apiMeta: SourceMetaApi | null = null
    if (rapidApiKey && !cookiesFile && !isLocalFile(source.url) && isYouTubeUrl(source.url)) {
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
            profile: profileOverride ?? activeProfile()
          })
          // Toujours approuvé : la validation manuelle se fait dans « Clips »
          // (bouton Rejeter). Un clip « en attente » ne serait jamais publié.
          repo.setClipReview(clip.id, 'approved')
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
// Planificateur de publication RETIRÉ : le pilote auto est désormais le SEUL moteur de
// publication (il publie chaque vidéo en direct, sans re-publication d'une file → plus
// de doublons). Le compte à rebours / la pause / la file de la page « File d'attente »
// reflètent le pilote (cron autopilot */15 + lissage 9h-23h, cf. /api/autopilot/plan),
// et non plus ce planificateur.
let task: ScheduledTask | null = null
function reloadScheduler(): void {
  if (task) {
    task.stop()
    task = null
  }
}

// ── Génération de vidéo « faceless » depuis une idée (une à la fois) ──
let videoChain: Promise<void> = Promise.resolve()
async function runVideoGen(
  ideaId: number,
  opts: { profile?: string; autoPublish?: boolean; imageStyle?: string; characterRefPath?: string; animateScenes?: boolean; dialogue?: boolean; noMusic?: boolean; videoType?: string; music?: string } = {}
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
    const cleanName = (f: string): string => f.replace(/^[a-z]+-\d+-/, '').replace(/\.[^.]+$/, '')
    if (opts.music === 'none') {
      // Choix explicite du bloc : aucune musique de fond.
    } else if (opts.music && opts.music !== 'auto' && tracks.includes(opts.music)) {
      // Choix manuel d'une piste précise pour ce bloc (prioritaire sur l'IA).
      musicTrack = join(musicDir, opts.music)
      emitIdeaVideo({ ideaId, status: 'running', message: `Musique : ${cleanName(opts.music)}` })
    } else if (idea.reproduce) {
      // Reproduction fidèle : la bande-son fait partie de ce qu'on reproduit.
      // Plaquer une piste de la playlist par-dessus dénature la source — on ne
      // met donc AUCUNE musique, sauf demande explicite d'une piste précise.
      emitIdeaVideo({ ideaId, status: 'running', message: 'Reproduction fidèle : pas de musique ajoutée.' })
    } else if (tracks.length && !opts.noMusic) {
      // Playlist du compte : on prend la piste suivante (rotation) → les vidéos
      // d'un même compte alternent. Prioritaire sur le choix IA.
      const rotated = nextMusicForProfile(targetProfile, tracks)
      if (rotated) {
        musicTrack = join(musicDir, rotated)
        repo.setSetting(`music_last_${targetProfile}`, rotated)
        emitIdeaVideo({ ideaId, status: 'running', message: `Musique : ${cleanName(rotated)} (playlist du compte)` })
      } else {
        // Aucune playlist définie → l'IA choisit selon l'ambiance de la vidéo.
        emitIdeaVideo({ ideaId, status: 'running', message: 'Choix de la musique (IA)…' })
        // Évite de rejouer le dernier morceau utilisé sur ce compte (variété).
        const lastKey = `music_last_${targetProfile}`
        const exclude = repo.getSetting(lastKey)
        const chosen = await chooseMusicTrack(anthropicKey, model, idea, tracks, exclude)
        if (chosen) {
          musicTrack = join(musicDir, chosen)
          repo.setSetting(lastKey, chosen)
          emitIdeaVideo({ ideaId, status: 'running', message: `Musique : ${cleanName(chosen)}` })
        }
      }
    }
    // Voix off : le fournisseur suit la VOIX choisie sur le compte (un id ElevenLabs
    // ⇒ ElevenLabs), sinon le réglage global. Sans clé ElevenLabs → OpenAI.
    const elevenKey = getEncrypted('elevenlabs_key')
    const globalEleven = (repo.getSetting('voice_provider') || 'openai') === 'elevenlabs' && !!elevenKey
    const acctVoice = profileVoice()[targetProfile]
    const narrationVoice = acctVoice || (globalEleven ? repo.getSetting('elevenlabs_default_voice') || '' : repo.getSetting('tts_voice') || 'ash')
    const useEleven = !!elevenKey && (globalEleven || providerForVoice(narrationVoice) === 'elevenlabs')
    const { filePath, durationSec, usage } = await generateVideoFromIdea(ctx, {
      anthropicKey,
      anthropicModel: model,
      openaiKey,
      voice: narrationVoice,
      voiceProvider: useEleven ? 'elevenlabs' : 'openai',
      elevenKey,
      idea,
      musicTrack,
      // Style des images : priorité à l'appelant (univers de série), sinon celui
      // porté par l'idée (mode inspiration : style repris de la vidéo source).
      imageStyle: opts.imageStyle ?? idea.imageStyle,
      geminiKey: getEncrypted('gemini_key'),
      characterRefPath: opts.characterRefPath,
      falKey: getEncrypted('fal_key'),
      falVideoModel: repo.getSetting('fal_video_model') || undefined,
      // Reproduction fidèle : la source est une VIDÉO, pas un diaporama. On anime
      // donc les scènes (fal.ai) si la clé est là, au lieu d'un simple Ken Burns
      // sur des images fixes.
      animateScenes: opts.animateScenes ?? (idea.reproduce && !!getEncrypted('fal_key')),
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
    repo.setClipReview(clip.id, 'approved')
    emitIdeaVideo({ ideaId, status: 'done', message: 'Vidéo prête ✅' })
    if (opts.autoPublish) {
      emitIdeaVideo({ ideaId, status: 'running', message: `Publication sur « ${targetProfile} »…` })
      await publishClipById(clip.id, paths, emitLog, { uploadPostUser: targetProfile, videoType: opts.videoType })
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
/** Date (Europe/Paris, YYYY-MM-DD) → clé des compteurs quotidiens. offsetDays>0 = jours à venir. */
function dayKey(offsetDays = 0): string {
  const d = offsetDays ? new Date(Date.now() + offsetDays * 86_400_000) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
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
// ── Chaînes/sources préférées pour la catégorie Clip : clip_channels = { [user]: texte } ──
function clipChannelsMap(): Record<string, string> {
  try {
    const raw = repo.getSetting('clip_channels')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}

/**
 * Choix AUTOMATIQUE d'une vidéo à cliper : Claude génère une requête de
 * recherche (niche + chaînes préférées), on cherche sur YouTube, on filtre
 * (15-120 min, jamais deux fois la même vidéo) et on renvoie l'URL.
 */
async function autoPickClipUrl(user: string, niche: string): Promise<string | null> {
  const rapidKey = getEncrypted('rapidapi_key')
  if (!rapidKey) {
    emitLog('Pilote auto : clé RapidAPI manquante — impossible de chercher une vidéo à cliper.')
    return null
  }
  const channels = (clipChannelsMap()[user] ?? '').trim()
  let query = channels ? `${channels.split(/\r?\n/)[0]} rediffusion` : `${niche} documentaire`
  try {
    const anthropicKey = getApiKey()
    if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 })
      const tool = {
        name: 'search_query',
        description: 'Requête de recherche YouTube.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Requête de recherche YouTube courte (3 à 6 mots)' } },
          required: ['query']
        }
      } as Anthropic.Tool
      const model = scriptModel()
      const msg = await client.messages.create({
        model,
        max_tokens: 120,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'search_query' },
        messages: [{
          role: 'user',
          content: `Génère UNE requête de recherche YouTube pour trouver une vidéo LONGUE (15 à 90 min : rediffusion de live, documentaire, reportage, podcast) idéale à découper en clips TikTok pour la niche « ${niche} ».${channels ? `\nChaînes/sources préférées (privilégie-les dans la requête) :\n${channels}` : ''}\nRéponds uniquement via l'outil search_query.`
        }]
      })
      if (msg.usage) addSpend(model, { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens })
      const block = msg.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') {
        const q = (block.input as { query?: string }).query
        if (q && q.trim()) query = q.trim()
      }
    }
  } catch {
    /* échec Claude → requête heuristique */
  }
  emitLog(`Pilote auto : recherche YouTube « ${query} »…`)
  try {
    const used = new Set(repo.listSources().map((s) => s.url))
    const results = await searchYouTubeVideos(rapidKey, query)
    const pick = results.find(
      (r) => r.durationSec != null && r.durationSec >= 15 * 60 && r.durationSec <= 120 * 60 && !used.has(r.url)
    )
    if (!pick) return null
    emitLog(`Pilote auto : vidéo choisie — « ${pick.title} » (${pick.channel ?? 'chaîne inconnue'}).`)
    return pick.url
  } catch (e) {
    emitLog(`Pilote auto : recherche YouTube échouée — ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ── Créneaux personnalisés PERSISTANTS (modèle) : heure et/ou type choisis PAR
// VIDÉO, appliqués CHAQUE jour tant que l'utilisateur ne les change pas (les
// compteurs, eux, se réinitialisent quotidiennement). Clé « <user>:<ordinal> ».
// autopilot_slot_overrides = { "<user>:<ordinal>": { hm?, type?, subject?, music?, from? } }
// (type: 'niche' | 'serie' | 'custom' | 'clip' | 'carousel' | 'slideshow' | 'stock' ;
//  'stock' = un clip précis de « Clips → En stock », subject = id du clip, publié UNE fois ;
//  music: nom de fichier | absent = auto IA | 'none' ;
//  from: date « YYYY-MM-DD » AVANT laquelle le créneau n'existe pas — posé quand le
//  bloc est créé depuis l'onglet Demain, pour que le rattrapage ne le lance pas le
//  soir même alors que son heure du jour est déjà passée)
type SlotOverride = { hm?: number; type?: string; subject?: string; music?: string; from?: string }
function slotOverrides(): Record<string, SlotOverride> {
  try {
    const raw = repo.getSetting('autopilot_slot_overrides')
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object') return {}
    // Migration de l'ancien format par-date { "YYYY-MM-DD": { "user:ord": {...} } } :
    // on adopte comme modèle le dernier jour NON VIDE qui avait été configuré.
    const dateKeys = Object.keys(o).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    if (dateKeys.length) {
      const nonEmpty = dateKeys
        .filter((k) => o[k] && typeof o[k] === 'object' && Object.keys(o[k] as object).length > 0)
        .sort()
      return nonEmpty.length ? (o[nonEmpty[nonEmpty.length - 1]] as Record<string, SlotOverride>) : {}
    }
    return o as Record<string, SlotOverride>
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
// Repli sur le réglage global `autopilot_per_day`. (Aucun plafond spécifique aux
// séries : un compte peut produire plusieurs épisodes/jour si sa cadence le permet.)
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

/**
 * Planning FIXE de la journée : chaque créneau reçoit une heure stable, calculée
 * indépendamment de l'heure courante. C'est la condition pour que « la vidéo part
 * à l'heure affichée » soit vrai : si on repartait de `maintenant`, l'heure des
 * blocs se décalerait à chaque rafraîchissement.
 *
 * Ordre : round-robin entre comptes (le compte avec le plus de vidéos restantes
 * passe en premier). Heures : réparties uniformément dans la fenêtre 9h–23h,
 * au centre de chaque tranche. Une heure épinglée sur un bloc la remplace.
 */
function dailySchedule(forDay = dayKey()): { user: string; ordinal: number; hm: number; pinned: boolean }[] {
  const profiles = uploadPostProfiles()
  const ov = slotOverrides()
  // Ordinaux ACTIFS ce jour-là : un bloc créé depuis « Demain » porte `from` et
  // n'existe pas avant cette date. Il ne consomme pas non plus de tranche horaire
  // aujourd'hui → les heures des blocs du jour ne bougent pas quand on prépare demain.
  const ords = new Map<string, number[]>()
  let total = 0
  for (const u of profiles) {
    const list: number[] = []
    for (let j = 1; j <= perDayForProfile(u); j++) {
      const p = ov[`${u}:${j}`]
      if (p?.from && p.from > forDay) continue
      list.push(j)
    }
    ords.set(u, list)
    total += list.length
  }
  const step = total > 0 ? (PUB_END_HOUR - PUB_START_HOUR) / total : 0
  const idx = new Map<string, number>()
  const out: { user: string; ordinal: number; hm: number; pinned: boolean }[] = []
  for (let i = 0; i < total; i++) {
    let best: string | null = null
    let bestLeft = 0
    for (const u of profiles) {
      const r = (ords.get(u)?.length ?? 0) - (idx.get(u) ?? 0)
      if (r > bestLeft) { bestLeft = r; best = u }
    }
    if (!best) break
    const pos = idx.get(best) ?? 0
    idx.set(best, pos + 1)
    const ordinal = (ords.get(best) ?? [])[pos]
    const p = ov[`${best}:${ordinal}`]
    out.push({
      user: best,
      ordinal,
      hm: p?.hm != null ? p.hm : PUB_START_HOUR + step * i + step / 2,
      pinned: p?.hm != null
    })
  }
  return out.sort((a, b) => a.hm - b.hm)
}

/** Un cycle : choisit le compte le PLUS EN RETARD (round-robin) et lui produit + publie 1 vidéo. */
async function runAutopilotTick(force = false): Promise<void> {
  if (!force && repo.getSetting('autopilot_enabled') !== '1') return
  if (autopilotBusy) return
  const today = dayKey()
  const profiles = uploadPostProfiles()
  if (!profiles.length) return
  // Quota du jour PAR COMPTE (réglable individuellement de 0 à 5).
  const perDayFor = perDayForProfile
  const ovToday = slotOverrides()
  const { hm: nowHm } = parisClock()
  const quotaOk = (u: string): boolean => {
    const ts = Number(repo.getSetting(`quota_reached_${u}`)) || 0
    return !(ts && Date.now() - ts < 6 * 60 * 60 * 1000)
  }
  const doneOf = (u: string): number => Number(repo.getSetting(`autopilot_count_${u}_${today}`)) || 0
  // Ordinaux DÉJÀ produits aujourd'hui pour un compte. Permet d'exécuter un bloc
  // épinglé à SON heure même s'il n'est pas le prochain dans l'ordre. Rétro-compat :
  // si le compteur dépasse l'ensemble stocké (données d'avant cette logique), on
  // considère les premiers ordinaux comme faits (ancien comportement en ordre).
  const doneOrdOf = (u: string): Set<number> => {
    let arr: number[] = []
    try {
      const p = JSON.parse(repo.getSetting(`autopilot_doneord_${u}_${today}`) || '[]')
      if (Array.isArray(p)) arr = p.filter((n): n is number => typeof n === 'number')
    } catch {
      /* ignore */
    }
    const set = new Set(arr)
    for (let j = 1; set.size < doneOf(u) && j <= perDayFor(u); j++) set.add(j)
    return set
  }
  const markDone = (u: string, ord: number): void => {
    const set = doneOrdOf(u)
    set.add(ord)
    repo.setSetting(`autopilot_doneord_${u}_${today}`, JSON.stringify([...set].sort((a, b) => a - b)))
    repo.setSetting(`autopilot_count_${u}_${today}`, String(set.size))
    // Réussi : on efface les traces de tentative/échec de ce créneau.
    try {
      const f = JSON.parse(repo.getSetting(`autopilot_failed_${u}_${today}`) || '{}') as Record<string, string>
      if (f[String(ord)]) { delete f[String(ord)]; repo.setSetting(`autopilot_failed_${u}_${today}`, JSON.stringify(f)) }
      const t = JSON.parse(repo.getSetting(`autopilot_tries_${u}_${today}`) || '{}') as Record<string, number>
      if (t[String(ord)]) { delete t[String(ord)]; repo.setSetting(`autopilot_tries_${u}_${today}`, JSON.stringify(t)) }
    } catch {
      /* ignore */
    }
  }
  // Créneaux EN ÉCHEC aujourd'hui (ordinal → message d'erreur). Un créneau qui échoue
  // est ÉCARTÉ de la sélection (sinon re-choisi en boucle → bloque les suivants), et son
  // erreur est exposée dans le planning (affichée sur le bloc). Retenté le lendemain.
  const failedMapOf = (u: string): Record<string, string> => {
    try {
      const o = JSON.parse(repo.getSetting(`autopilot_failed_${u}_${today}`) || '{}')
      if (o && typeof o === 'object') return o as Record<string, string>
    } catch {
      /* ignore */
    }
    return {}
  }
  const markFailed = (u: string, ord: number, error: string): void => {
    const m = failedMapOf(u)
    m[String(ord)] = (error || 'échec').slice(0, 200)
    repo.setSetting(`autopilot_failed_${u}_${today}`, JSON.stringify(m))
  }
  // Tentatives par créneau, incrémentées AVANT la génération. Si le process meurt
  // en cours de route (redémarrage, crash, OOM), le `finally` ne s'exécute pas : sans
  // ce compteur le créneau serait re-choisi indéfiniment et régénérerait une vidéo à
  // chaque cycle (crédits gaspillés). Ici, il est écarté après MAX_TRIES tentatives.
  const MAX_TRIES = 2
  const triesOf = (u: string): Record<string, number> => {
    try {
      const o = JSON.parse(repo.getSetting(`autopilot_tries_${u}_${today}`) || '{}')
      if (o && typeof o === 'object') return o as Record<string, number>
    } catch {
      /* ignore */
    }
    return {}
  }
  const bumpTry = (u: string, ord: number): void => {
    const m = triesOf(u)
    m[String(ord)] = (Number(m[String(ord)]) || 0) + 1
    repo.setSetting(`autopilot_tries_${u}_${today}`, JSON.stringify(m))
  }
  // Ordinaux à SAUTER dans la sélection : déjà produits OU en échec aujourd'hui.
  const skipOrdOf = (u: string): Set<number> =>
    new Set<number>([...doneOrdOf(u), ...Object.keys(failedMapOf(u)).map(Number)])

  // ── Sélection : le premier créneau du planning fixe dont l'heure est arrivée ──
  // Plus de lissage ni de fenêtre de tolérance : un bloc part à SON heure. Un bloc
  // dont l'heure est passée (pilote éteint, serveur redémarré) est rattrapé, sinon
  // rallumer le pilote en cours de journée ne produirait plus rien.
  // En mode test (« force »), on ignore l'heure et on prend le premier créneau dû.
  let picked: { user: string; ordinal: number } | null = null
  for (const s of dailySchedule()) {
    if (!force && s.hm > nowHm) continue
    if (!quotaOk(s.user)) continue
    if (doneOf(s.user) >= perDayFor(s.user)) continue
    if (skipOrdOf(s.user).has(s.ordinal)) continue
    picked = { user: s.user, ordinal: s.ordinal }
    break
  }
  if (!picked) return

  const { user, ordinal } = picked
  const done = doneOf(user)
  const slotOv = ovToday[`${user}:${ordinal}`] ?? {}
  const niche = nicheForProfile(user)

  // Garde-fou anti-boucle : un créneau déjà tenté MAX_TRIES fois sans succès est
  // écarté. Couvre le cas où le process est tué en pleine génération (le `finally`
  // ci-dessous ne tourne alors PAS) — sinon on régénérerait une vidéo à chaque cycle.
  const nTries = Number(triesOf(user)[String(ordinal)]) || 0
  if (nTries >= MAX_TRIES) {
    markFailed(user, ordinal, `abandonné après ${MAX_TRIES} tentatives interrompues (redémarrage ou plantage ?)`)
    emitLog(`Pilote auto : créneau n°${ordinal} de « ${user} » écarté après ${MAX_TRIES} tentatives sans résultat.`)
    return
  }
  bumpTry(user, ordinal)

  // Suivi du résultat de ce créneau : si rien n'est produit (échec), on l'écarte pour
  // la journée AVEC son erreur (markFailed dans le finally) → le planning continue.
  let produced = false
  let failReason = ''
  autopilotBusy = true
  try {
    const anthropicKey = getApiKey()
    if (!anthropicKey) { failReason = 'clé Claude manquante'; emitLog('Pilote auto : clé Claude manquante.'); return }
    const model = scriptModel()
    // Tendances TikTok du moment (si l'API est configurée) → scénarios ancrés sur l'actu.
    const trends = await getTrendsCached()

    const subject = (slotOv.subject ?? '').trim()

    // ── Type « stock » : publie un clip PRÉCIS déjà en stock (choisi dans le
    // bloc, subject = id du clip). Publication UNIQUE : le choix est ensuite
    // retiré du modèle — le lendemain, le bloc repart en automatique (un clip
    // ne se publie qu'une fois, sinon le modèle pointerait un clip déjà parti).
    if (slotOv.type === 'stock') {
      const clearStock = (): void => {
        try {
          const map = slotOverrides()
          const k = `${user}:${ordinal}`
          const o = map[k]
          if (o && o.type === 'stock') {
            delete o.type
            delete o.subject
            if (o.hm == null && !o.music) delete map[k]
            else map[k] = o
            repo.setSetting('autopilot_slot_overrides', JSON.stringify(map))
          }
        } catch { /* ignore */ }
      }
      const clipId = Number(subject)
      const clip = Number.isFinite(clipId) ? repo.getClip(clipId) : null
      if (!clip || !clip.filePath) {
        failReason = 'clip en stock introuvable (supprimé ?)'
        clearStock()
        emitLog(`Pilote auto : le clip en stock n°${subject} de « ${user} » est introuvable — créneau remis en automatique.`)
        return
      }
      if (clip.publishStatus === 'published') {
        failReason = 'clip déjà publié'
        clearStock()
        emitLog(`Pilote auto : le clip « ${clip.title ?? `n°${clip.id}`} » est déjà publié — créneau remis en automatique.`)
        return
      }
      // is_aigc : un clip issu d'une génération IA (source `idea:…`) doit être
      // étiqueté contenu généré ; un extrait YouTube réel, non.
      const stockSrc = repo.getSource(clip.sourceId)
      const isAI = !!stockSrc?.url?.startsWith('idea:')
      emitLog(`Pilote auto : publication du clip en stock « ${clip.title ?? `n°${clip.id}`} » sur « ${user} »…`)
      try {
        await publishClipById(clip.id, paths, emitLog, { uploadPostUser: user, videoType: isAI ? 'niche' : 'clip' })
      } catch (e) {
        // Uploads TikTok asynchrones : un clip « échoué » mais en réalité posté
        // serait re-publiable → on le sort de la file (même garde-fou que « clip »).
        repo.setClipReview(clip.id, 'pending')
        throw e
      }
      markDone(user, ordinal)
      produced = true
      clearStock()
      emitLog(`Pilote auto : clip en stock publié sur « ${user} » (${done + 1}/${perDayFor(user)} aujourd'hui).`)
      return
    }

    // ── Type « clip » : découpe les meilleurs moments d'une rediff de live /
    // d'un reportage YouTube et publie le meilleur. URL du bloc, ou CHOIX AUTO
    // par l'IA (recherche selon la niche + chaînes préférées) si URL vide.
    if (slotOv.type === 'clip') {
      const publishBest = async (candidates: import('../src/shared/types').ClipDTO[]): Promise<boolean> => {
        const clip = candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
        if (!clip) return false
        try {
          // Publication en DIRECT par le pilote (publishClipById marque 'published' en
          // cas de succès → le planificateur l'ignore ensuite).
          await publishClipById(clip.id, paths, emitLog, { uploadPostUser: user, videoType: 'clip' })
          markDone(user, ordinal)
          produced = true
          emitLog(`Pilote auto : clip publié sur « ${user} » (${done + 1}/${perDayFor(user)} aujourd'hui).`)
          return true
        } catch (e) {
          // Échec : on RETIRE le clip de la file de republication automatique
          // (nextApprovedUnpublished repêche les clips 'approved' non publiés). Comme
          // les uploads TikTok sont asynchrones, un clip marqué 'failed' mais en réalité
          // posté serait re-publié par le planificateur → DOUBLON (ex. le scanner ×3).
          // On préfère regénérer une nouvelle vidéo au cycle suivant.
          repo.setClipReview(clip.id, 'pending')
          throw e
        }
      }

      let clipUrl = /^https?:\/\//i.test(subject) ? subject : null
      if (!clipUrl) {
        // L'IA choisit une NOUVELLE vidéo (jamais déjà utilisée). On ne recycle plus
        // les extraits restants d'une même source : 1 publication = 1 vidéo différente
        // (sinon on postait 3 clips du même Squeezie → effet doublon).
        clipUrl = await autoPickClipUrl(user, niche)
        if (!clipUrl) {
          failReason = 'aucune vidéo à cliper trouvée (recherche YouTube)'
          emitLog(`Pilote auto : aucune vidéo trouvée à cliper pour « ${user} » — réessai au prochain cycle.`)
          return
        }
      }

      // Réutilise une source déjà analysée pour cette URL (clip restant) ;
      // sinon pipeline complet : téléchargement → analyse IA → 1 clip 9:16 (meilleur moment).
      let candidates = repo
        .listSources()
        .filter((s) => s.url === clipUrl && s.status === 'done')
        .flatMap((s) => repo.listClips(s.id))
        .filter((c) => c.publishStatus !== 'published')
      if (!candidates.length) {
        emitLog(`Pilote auto : extraction de clips depuis ${clipUrl} pour « ${user} » (téléchargement + analyse)…`)
        const created = repo.createSource(clipUrl)
        const job = pipelineChain.then(() => runForSource(created.id, 1, user))
        pipelineChain = job.then(() => undefined, () => undefined)
        await job
        const after = repo.getSource(created.id)
        if (!after || after.status !== 'done') {
          failReason = `téléchargement échoué : ${after?.error ?? 'erreur inconnue'}`
          emitLog(`Pilote auto : extraction échouée pour « ${user} » — ${after?.error ?? 'erreur inconnue'}.`)
          return
        }
        candidates = repo.listClips(created.id).filter((c) => c.publishStatus !== 'published')
      }
      if (!(await publishBest(candidates))) {
        failReason = 'aucun clip exploitable dans la vidéo'
        emitLog(`Pilote auto : aucun clip exploitable dans ${clipUrl}.`)
      }
      return
    }

    // ── Type « carrousel » : un post PHOTO (images qu'on fait défiler), écrit et
    // illustré dans la niche du compte, publié via l'endpoint photos d'upload-post.
    if (slotOv.type === 'carousel' || slotOv.type === 'slideshow') {
      const asVideo = slotOv.type === 'slideshow'
      const openaiKey = getEncrypted('openai_key')
      if (!openaiKey) { failReason = 'clé OpenAI manquante'; emitLog('Pilote auto : clé OpenAI manquante (images du carrousel).'); return }
      const upKey = getEncrypted('uploadpost_key')
      if (!upKey) { failReason = 'clé upload-post manquante'; emitLog('Pilote auto : clé upload-post manquante.'); return }
      const topic = subject || niche
      emitLog(`Pilote auto : carrousel photo pour « ${user} » (${topic})…`)
      const cctx = await getContext()
      const { files, carousel, usage } = await generateCarousel(cctx, {
        anthropicKey,
        anthropicModel: model,
        openaiKey,
        niche: topic,
        cta: ctaMapForProfile(user).niche ?? '',
        onProgress: (m: string) => emitLog(`Pilote auto (carrousel) : ${m}`)
      })
      if (usage) addSpend(model, usage)
      const caption = [carousel.caption, carousel.hashtags.join(' ')].filter(Boolean).join('\n\n')

      // ── Diaporama VIDÉO : le seul mode où l'on impose sa musique (TikTok ne
      // laisse joindre aucun audio à un post photo natif). Même sélection de
      // piste que les vidéos : piste du bloc > 'none' > rotation de la playlist.
      if (asVideo) {
        const tracks = musicTracks()
        let musicPath: string | undefined
        if (slotOv.music && slotOv.music !== 'auto' && slotOv.music !== 'none' && tracks.includes(slotOv.music)) {
          musicPath = join(musicDir, slotOv.music)
        } else if (slotOv.music !== 'none') {
          const rotated = nextMusicForProfile(user, tracks)
          if (rotated) musicPath = join(musicDir, rotated)
        }
        const { filePath, durationSec } = await assembleSlideshow(cctx, files, musicPath)
        const src = repo.createSource(`idea:slideshow-${Date.now()}`)
        repo.updateSource(src.id, { status: 'done', title: carousel.title, durationSec, filePath })
        const clip = repo.createClip({
          sourceId: src.id,
          startSec: 0,
          endSec: durationSec,
          filePath,
          title: carousel.title,
          description: carousel.caption,
          hashtags: carousel.hashtags.join(' '),
          profile: user
        })
        repo.setClipReview(clip.id, 'approved')
        await publishClipById(clip.id, paths, emitLog, { uploadPostUser: user, videoType: 'niche' })
        markDone(user, ordinal)
        produced = true
        emitLog(`Pilote auto : diaporama de ${files.length} images publié sur « ${user} »${musicPath ? ` (musique : ${basename(musicPath)})` : ' (sans musique)'}.`)
        return
      }

      const { url, postId } = await uploadPostTikTokPhotos({
        apiKey: upKey,
        user,
        filePaths: files,
        caption,
        title: carousel.title,
        // `carousel_privacy` : confidentialité PROPRE aux carrousels (le réglage
        // global vaut pour les vidéos). Permet de publier un carrousel en
        // « Moi uniquement » pour le relire avant de le rendre public à la main.
        privacyLevel: repo.getSetting('carousel_privacy') || repo.getSetting('tiktok_privacy') || 'PUBLIC_TO_EVERYONE',
        onNote: emitLog
      })
      // Trace en base : la couverture sert de vignette dans « Clips → Publiés ».
      const src = repo.createSource(`idea:carousel-${Date.now()}`)
      repo.updateSource(src.id, { status: 'done', title: carousel.title })
      const clip = repo.createClip({
        sourceId: src.id,
        startSec: 0,
        endSec: 0,
        filePath: files[0],
        title: carousel.title,
        description: carousel.caption,
        hashtags: carousel.hashtags.join(' '),
        profile: user
      })
      repo.updateClip(clip.id, {
        reviewStatus: 'approved',
        publishStatus: 'published',
        publishedAccount: user,
        postUrl: url,
        postId
      })
      markDone(user, ordinal)
      produced = true
      emitLog(`Pilote auto : carrousel de ${files.length} images publié sur « ${user} » (${done + 1}/${perDayFor(user)} aujourd'hui).`)
      return
    }

    // Type du créneau : par défaut vidéo de niche ; « Épisode de série » ou
    // « Sujet libre » se choisissent explicitement sur le bloc du planning.
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
      // Anti-répétition : on transmet à l'IA les titres récents du compte pour qu'elle
      // évite de refaire les mêmes sujets (cause n°1 du plafonnement des vues).
      const recentTitles = repo
        .listClips()
        .filter((c) => c.profile === user && !!c.title)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, 30)
        .map((c) => c.title as string)
      // Boucle d'apprentissage : ce qui a le mieux et le moins bien engagé sur CE
      // compte est transmis à l'IA (jamais pour être copié — pour en tirer le ressort).
      const lessons = performanceLessons(await recentPostStats(user).catch(() => []))
      const { ideas, usage } = await generateViralIdeas({ apiKey: anthropicKey, model, niche: topic, count: 1, trends, recentTitles, lessons })
      if (usage) addSpend(model, usage)
      if (!ideas.length) { failReason = 'aucune idée générée'; emitLog(`Pilote auto : aucune idée générée pour « ${user} ».`); return }
      idea = ideas[0]
      if (slotOv.type === 'custom' && subject) ideaLabel = subject
    }

    const saved = repo.createIdea(ideaLabel, idea)
    // On passe par videoChain pour ne jamais monter deux vidéos en parallèle.
    const job = videoChain.then(() =>
      runVideoGen(saved.id, {
        profile: user,
        autoPublish: true,
        videoType: series ? 'serie' : slotOv.type === 'custom' ? 'custom' : 'niche',
        imageStyle: series?.universe,
        characterRefPath: refPath,
        animateScenes: !!series, // séries = scènes animées (fal.ai) si la clé est configurée
        dialogue: !!series, // séries = les personnages parlent (voix par personnage)
        noMusic: !!series, // séries = pas de musique de fond (dialogues seuls)
        music: slotOv.music // musique choisie sur le bloc (nom de fichier / 'none' / absent = auto IA)
      })
    )
    videoChain = job.then(() => undefined, () => undefined)
    const clipId = await job.catch(() => null)
    if (clipId) {
      markDone(user, ordinal)
      produced = true
      if (series && nextRecap != null) advanceSeries(user, nextRecap) // mémoire + épisode suivant
      emitLog(`Pilote auto : vidéo publiée sur « ${user} » (${done + 1}/${perDayFor(user)} aujourd'hui).`)
    } else {
      failReason = 'échec de génération / publication de la vidéo'
      emitLog(`Pilote auto : échec pour « ${user} » (voir journaux).`)
    }
  } catch (e) {
    failReason = e instanceof Error ? e.message : String(e)
    emitLog(`Pilote auto : erreur pour « ${user} » — ${failReason}`)
  } finally {
    // Rien produit → on écarte ce créneau pour aujourd'hui (avec son erreur) : le
    // planning CONTINUE sur les suivants au lieu de boucler indéfiniment sur celui-ci.
    if (!produced) markFailed(user, ordinal, failReason)
    autopilotBusy = false
  }
}

function reloadAutopilot(): void {
  if (autopilotTask) {
    autopilotTask.stop()
    autopilotTask = null
  }
  // Le cron tourne TOUJOURS : c'est le tick qui vérifie l'interrupteur à chaque
  // minute. Planifier seulement si activé créait un piège : un démarrage pilote
  // coupé puis une activation du flag en base (sans passer par l'API) laissait
  // « En marche » à l'écran… sans aucune horloge derrière.
  // Passage CHAQUE MINUTE : le tick ne fait rien tant qu'aucun créneau n'est dû,
  // et démarre un créneau à la minute exacte de son heure prévue.
  const expr = repo.getSetting('autopilot_cron') || '* * * * *'
  if (!cron.validate(expr)) return
  autopilotTask = cron.schedule(expr, () => {
    void runAutopilotTick().catch((e) => emitLog(`Pilote auto : ${e instanceof Error ? e.message : String(e)}`))
  })
  if (repo.getSetting('autopilot_enabled') === '1') emitLog('Pilote auto activé — chaque vidéo part à son heure prévue.')
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

// Historique complet de l'activité (console du dashboard). `before` = id
// exclusif pour remonter le fil page par page.
app.get('/api/activity', wrap((req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
  const beforeRaw = Number(req.query.before)
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined
  res.json(repo.listActivity(limit, before))
}))

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
  // Tendances : celles passées par l'appelant, sinon celles de l'API configurée
  // (le front n'en envoyait aucune → la génération manuelle n'en profitait jamais).
  const given = Array.isArray(req.body?.trends) ? (req.body.trends as unknown[]).map(String).slice(0, 25) : []
  const trends = given.length ? given : await getTrendsCached()
  const model = scriptModel()
  const { ideas, usage } = await generateViralIdeas({ apiKey, model, niche, count, trends })
  if (usage) addSpend(model, usage)
  // On enregistre chaque idée générée (page « Mes idées »).
  const saved = ideas.map((idea) => repo.createIdea(niche, idea))
  res.json({ ideas: saved })
}))
/** Suit les redirections et renvoie l'URL finale (les liens courts la masquent). */
async function resolveRedirect(url: string): Promise<string> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    })
    clearTimeout(t)
    void r.body?.cancel() // on ne veut que l'URL finale, pas le HTML
    return r.url || url
  } catch {
    return url // pas de réseau / timeout : on laisse le pipeline tenter sa chance
  }
}

/**
 * Traduit un échec yt-dlp en message exploitable. Le code de sortie seul
 * (« a terminé avec le code 1 ») n'apprend rien : la cause est dans la ligne
 * « ERROR: … » du stderr, qui suit dans le message d'erreur.
 */
function downloadFailureReason(raw: string): string {
  const errLine =
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('ERROR:'))
      .pop() ?? ''
  const detail = errLine.replace(/^ERROR:\s*/, '')

  // Cas le plus fréquent avec TikTok : le lien pointe un diaporama photo.
  if (/tiktok\.com\/@[^/\s]+\/photo\//i.test(raw)) {
    return 'ce lien TikTok est un diaporama photo, pas une vidéo : il n’y a aucune vidéo à télécharger. Copie le lien d’une vraie vidéo.'
  }
  if (/Sign in to confirm|not a bot/i.test(raw)) {
    return 'YouTube demande une confirmation anti-bot — mets à jour les cookies YouTube dans les Réglages.'
  }
  if (/private video/i.test(raw)) return 'la vidéo est privée.'
  if (/video unavailable|no longer available|removed/i.test(raw)) return 'la vidéo n’est plus disponible.'
  if (/age.?restricted|confirm your age/i.test(raw)) return 'la vidéo est limitée par l’âge — des cookies sont nécessaires.'
  if (/unsupported url/i.test(raw)) return `lien non pris en charge par le téléchargeur. ${detail}`.slice(0, 300)

  return (detail || raw.split('\n')[0]).slice(0, 260)
}

// Inspiration : télécharge un TikTok (ou Short) qui marche, le transcrit, et écrit
// une idée ORIGINALE reprenant sa mécanique virale (structure, hook, levier) — pas son contenu.
app.post('/api/ideas/inspire', wrap(async (req, res) => {
  const apiKey = getApiKey()
  if (!apiKey) return res.status(400).json({ error: 'Configure d’abord ta clé API Claude dans les Réglages.' })
  const url = String(req.body?.url ?? '').trim()
  const niche = String(req.body?.niche ?? '').trim().slice(0, 120)
  const mode: 'reproduce' | 'inspire' = (req.body as { mode?: unknown })?.mode === 'inspire' ? 'inspire' : 'reproduce'
  if (!/^https?:\/\/([\w-]+\.)*(tiktok\.com|youtube\.com|youtu\.be)\//i.test(url)) {
    return res.status(400).json({ error: 'Colle un lien TikTok (ou YouTube Short) valide.' })
  }
  // Les liens courts vm.tiktok.com masquent parfois un DIAPORAMA PHOTO (/photo/),
  // que yt-dlp ne sait pas télécharger. On résout la redirection d'abord :
  // l'utilisateur a l'erreur tout de suite au lieu d'un échec après téléchargement.
  if (/tiktok\.com/i.test(url)) {
    const finalUrl = await resolveRedirect(url)
    if (/tiktok\.com\/@[^/\s]+\/photo\//i.test(finalUrl)) {
      return res.status(400).json({
        error: 'Ce lien TikTok est un diaporama photo, pas une vidéo — il n’y a rien à reproduire. Copie le lien d’une vraie vidéo.'
      })
    }
  }
  const ctx = await getContext()
  const cookiesFile = repo.getSetting('ytdlp_cookies_file') || null
  const tmpId = Date.now() // stem des fichiers temporaires dans downloads/ (hors plage des vrais ids)

  emitLog(`Inspiration : analyse de ${url}…`)
  const meta = await fetchMetadata(ctx, url, null, cookiesFile).catch(() => ({ title: null, author: null, durationSec: null }))
  if (meta.durationSec && meta.durationSec > 600) {
    return res.status(400).json({ error: 'Vidéo trop longue pour l’inspiration (10 min max).' })
  }

  let filePath: string | null = null
  try {
    emitLog('Inspiration : téléchargement de la vidéo source…')
    try {
      filePath = await downloadVideo(ctx, url, tmpId, undefined, null, cookiesFile)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      throw new Error(`Téléchargement impossible — ${downloadFailureReason(m)}`)
    }

    // Transcription de la voix : Groq (rapide) si configuré, sinon whisper local.
    emitLog('Inspiration : transcription de la voix…')
    let transcript = ''
    try {
      const groqKey = getEncrypted('groq_key')
      const words = groqKey
        ? await transcribeWithGroq(ctx, groqKey, filePath, tmpId)
        : await ensureWhisper(paths.bin, paths.models, (m) => emitLog(`Inspiration : ${m}`)).then((w) =>
            transcribeSource(ctx, w, filePath as string, tmpId)
          )
      transcript = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim()
    } catch (e) {
      // Pas bloquant : vidéo musicale/sans parole, ou transcription indisponible →
      // l'IA s'appuiera sur le titre/la légende.
      emitLog(`Inspiration : transcription impossible (${e instanceof Error ? e.message.split('\n')[0] : e}) — analyse sur les métadonnées seules.`)
    }

    // Captures d'écran réparties sur la vidéo → Claude (vision) en déduit le STYLE
    // VISUEL de la source, réappliqué ensuite aux images de la nouvelle vidéo.
    emitLog('Inspiration : analyse du style visuel…')
    const frames: string[] = []
    try {
      const dur = meta.durationSec || (await probeDuration(ctx, filePath).catch(() => 0))
      const times = dur > 2 ? [0.12, 0.38, 0.62, 0.85].map((r) => r * dur) : [0.5, 1, 2, 3]
      for (let i = 0; i < times.length; i++) {
        const jpg = join(paths.downloads, `${tmpId}.f${i}.jpg`)
        try {
          await run(ctx.bin.ffmpeg, ['-y', '-ss', times[i].toFixed(2), '-i', filePath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', jpg])
          if (existsSync(jpg)) frames.push(readFileSync(jpg).toString('base64'))
        } catch {
          /* frame hors durée → on garde celles qui ont marché */
        }
      }
    } catch {
      /* pas bloquant : l'IA décrira un style plausible sans captures */
    }

    emitLog(mode === 'reproduce' ? 'Inspiration : reproduction fidèle de la vidéo (IA)…' : 'Inspiration : écriture d’une idée originale (IA)…')
    const model = scriptModel()
    const { idea, usage } = await generateInspiredIdea({
      apiKey,
      model,
      niche: niche || undefined,
      source: { title: meta.title, author: meta.author, durationSec: meta.durationSec, transcript },
      frames,
      mode
    })
    if (usage) addSpend(model, usage)
    if (!idea) return res.status(502).json({ error: 'L’IA n’a pas réussi à produire une idée — réessaie.' })
    const label = niche || `${mode === 'reproduce' ? 'Reproduction' : 'Inspiration'} : ${meta.author || 'TikTok'}`
    const saved = repo.createIdea(label, idea)
    emitLog(`Inspiration : idée créée — « ${idea.title} »`)
    res.json({ idea: saved })
  } finally {
    // Nettoyage des fichiers temporaires (vidéo + audio/JSON de transcription + captures).
    for (const f of [
      filePath,
      join(paths.downloads, `${tmpId}.mp3`),
      join(paths.downloads, `${tmpId}.wav`),
      join(paths.downloads, `${tmpId}.whisper.json`),
      join(paths.clips, `${tmpId}.transcript.json`),
      ...[0, 1, 2, 3].map((i) => join(paths.downloads, `${tmpId}.f${i}.jpg`))
    ]) {
      if (f && existsSync(f)) rmSync(f, { force: true })
    }
  }
}))
// Cache des profils upload-post (avatar + @handle) pour ne pas spammer l'API (429).
let profilesCache: { at: number; data: UploadPostProfile[] } | null = null
/**
 * Filet « dernière valeur connue » (persisté en DB) : l'API upload-post renvoie
 * parfois un profil SANS ses données TikTok (handle/avatar null, rafraîchissement
 * interne côté upload-post). Sans ce filet, l'UI retombe sur la lettre « C » et le
 * nom brut jusqu'au prochain tirage correct — visible surtout après un déploiement
 * (les caches mémoire repartent de zéro). Toute valeur fraîche non nulle met à
 * jour le magasin ; une valeur nulle est comblée par la dernière connue.
 */
function stickyProfileMeta(data: UploadPostProfile[]): UploadPostProfile[] {
  type Known = Record<string, { handle: string | null; avatarUrl: string | null }>
  let store: Known = {}
  try {
    store = JSON.parse(repo.getSetting('uploadpost_profile_meta') || '{}') as Known
  } catch {
    /* JSON invalide → on repart de zéro */
  }
  let dirty = false
  const out = data.map((p) => {
    const known = store[p.username]
    const merged = {
      ...p,
      tiktokHandle: p.tiktokHandle ?? known?.handle ?? null,
      avatarUrl: p.avatarUrl ?? known?.avatarUrl ?? null
    }
    if ((merged.tiktokHandle || merged.avatarUrl) && (known?.handle !== merged.tiktokHandle || known?.avatarUrl !== merged.avatarUrl)) {
      store[p.username] = { handle: merged.tiktokHandle, avatarUrl: merged.avatarUrl }
      dirty = true
    }
    return merged
  })
  if (dirty) repo.setSetting('uploadpost_profile_meta', JSON.stringify(store))
  return out
}
async function cachedUploadPostProfiles(): Promise<UploadPostProfile[]> {
  const key = getEncrypted('uploadpost_key')
  if (!key) return []
  if (profilesCache && Date.now() - profilesCache.at < 5 * 60 * 1000) return profilesCache.data
  try {
    const data = stickyProfileMeta(await listUploadPostProfiles(key))
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
interface PostStatRow {
  clipId: number
  title: string | null
  filePath: string | null
  postUrl: string | null
  createdAt: number
  views: number
  likes: number
  comments: number
  shares: number
}
const postsCache = new Map<string, { at: number; posts: PostStatRow[] }>()
/**
 * Stats des 20 dernières vidéos d'un compte (cache 10 min). Sert à l'affichage
 * ET à la boucle d'apprentissage du pilote.
 */
async function recentPostStats(profile: string): Promise<PostStatRow[]> {
  const key = getEncrypted('uploadpost_key')
  if (!profile || !key) return []
  const cached = postsCache.get(profile)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.posts
  const clips = repo
    .listClips()
    .filter((c) => c.publishedAccount === profile && c.postId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
  const posts: PostStatRow[] = []
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
  return posts
}

/**
 * Ce que le compte doit retenir de ses publications : les 3 meilleures et les
 * 3 pires, classées sur l'ENGAGEMENT (partages + commentaires + likes rapportés
 * aux vues) et non sur les vues brutes.
 *
 * Pourquoi pas les vues : elles dépendent d'abord du palier de diffusion accordé
 * par TikTok. Sur un compte plafonné, toutes les vidéos font le même score et il
 * n'y a aucun signal à extraire. Les ratios, eux, mesurent ce que l'audience a
 * VRAIMENT fait — et ce sont eux qui décident du palier suivant.
 */
function performanceLessons(posts: PostStatRow[]): { top: string[]; flop: string[] } | null {
  const scored = posts
    .filter((p) => p.views >= 50 && p.title) // trop peu de vues = bruit
    .map((p) => ({
      title: p.title as string,
      // Les partages pèsent le plus lourd : c'est le signal n°1 du 2e palier.
      score: (p.shares * 5 + p.comments * 3 + p.likes) / Math.max(1, p.views),
      detail: `${p.views} vues, ${p.shares} partage${p.shares > 1 ? 's' : ''}, ${p.comments} commentaire${p.comments > 1 ? 's' : ''}, ${p.likes} likes`
    }))
    .sort((a, b) => b.score - a.score)
  if (scored.length < 6) return null // pas assez de recul pour conclure
  const fmt = (x: { title: string; detail: string }): string => `- « ${x.title} » (${x.detail})`
  return { top: scored.slice(0, 3).map(fmt), flop: scored.slice(-3).map(fmt) }
}

app.get('/api/analytics/posts', wrap(async (req, res) => {
  res.json({ posts: await recentPostStats(String(req.query.profile ?? '')) })
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

/**
 * Transforme une idée enregistrée en DIAPORAMA d'images (6 diapos illustrées,
 * texte incrusté) assemblé en MP4 avec la musique du compte actif. Le résultat
 * arrive dans « Clips » NON publié : on relit avant d'envoyer, comme une vidéo.
 */
app.post('/api/ideas/:id/slideshow', wrap((req, res) => {
  const id = Number(req.params.id)
  const saved = repo.getIdea(id)
  if (!saved) return res.status(404).json({ error: 'Idée introuvable' })
  const anthropicKey = getApiKey()
  if (!anthropicKey) return res.status(400).json({ error: 'Configure ta clé Claude dans les Réglages.' })
  const openaiKey = getEncrypted('openai_key')
  if (!openaiKey) return res.status(400).json({ error: 'Configure ta clé OpenAI dans les Réglages.' })

  // Même file que les vidéos : jamais deux montages ffmpeg en parallèle.
  videoChain = videoChain
    .then(async () => {
      const model = scriptModel()
      emitIdeaVideo({ ideaId: id, status: 'running', message: 'Écriture des diapos…' })
      const ctx = await getContext()
      const { files, carousel, usage } = await generateCarousel(ctx, {
        anthropicKey,
        anthropicModel: model,
        openaiKey,
        niche: saved.niche,
        source: { title: saved.title, hook: saved.hook, script: saved.script },
        onProgress: (m) => emitIdeaVideo({ ideaId: id, status: 'running', message: m })
      })
      if (usage) addSpend(model, usage)
      const tracks = musicTracks()
      const profile = activeProfile()
      const rotated = profile ? nextMusicForProfile(profile, tracks) : tracks[0]
      const { filePath, durationSec } = await assembleSlideshow(ctx, files, rotated ? join(musicDir, rotated) : undefined)
      const src = repo.createSource(`idea:${id}`)
      repo.updateSource(src.id, { status: 'done', title: carousel.title, durationSec, filePath })
      const clip = repo.createClip({
        sourceId: src.id,
        startSec: 0,
        endSec: durationSec,
        filePath,
        title: carousel.title,
        description: carousel.caption,
        hashtags: carousel.hashtags.join(' '),
        profile: profile || null
      })
      repo.setClipReview(clip.id, 'approved')
      emitIdeaVideo({ ideaId: id, status: 'done', message: `Diaporama de ${files.length} images prêt — voir « Clips »` })
    })
    .then(
      () => undefined,
      (e) => {
        emitIdeaVideo({ ideaId: id, status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    )
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
// Réglage + test de l'API de tendances : on affiche les tags RÉELLEMENT extraits
// (ou l'erreur), pour pouvoir juger la qualité des données AVANT de payer un plan.
// Ordre d'affichage des comptes sur le planning (glisser-déposer). Purement
// visuel : il ne change PAS les heures calculées, sinon réordonner déplacerait
// silencieusement les publications de la journée.
function accountOrder(): string[] {
  try {
    const r = JSON.parse(repo.getSetting('autopilot_account_order') || '[]') as unknown
    return Array.isArray(r) ? r.map(String) : []
  } catch {
    return []
  }
}
app.post('/api/autopilot/order', wrap((req, res) => {
  const raw = (req.body ?? {}) as { order?: unknown }
  const known = uploadPostProfiles()
  const order = Array.isArray(raw.order) ? raw.order.map(String).filter((u) => known.includes(u)) : []
  repo.setSetting('autopilot_account_order', JSON.stringify(order))
  res.json({ ok: true })
}))

app.get('/api/trends/config', wrap((_req, res) => {
  res.json({
    host: repo.getSetting('trends_host') || 'tiktok-trending-data.p.rapidapi.com',
    path: repo.getSetting('trends_path') || '',
    hasKey: !!getEncrypted('rapidapi_key')
  })
}))
app.post('/api/trends/config', wrap((req, res) => {
  const b = (req.body ?? {}) as { host?: unknown; path?: unknown }
  if (b.host !== undefined) repo.setSetting('trends_host', String(b.host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
  if (b.path !== undefined) {
    const p = String(b.path ?? '').trim()
    repo.setSetting('trends_path', p ? (p.startsWith('/') ? p : `/${p}`) : '')
  }
  trendsCache = null // la config a changé → on ne sert pas d'anciens tags
  res.json({ ok: true })
}))
app.post('/api/trends/test', wrap(async (_req, res) => {
  const key = getEncrypted('rapidapi_key')
  if (!key) return res.status(400).json({ error: 'Clé RapidAPI manquante (Réglages).' })
  const host = repo.getSetting('trends_host') || 'tiktok-trending-data.p.rapidapi.com'
  const path = repo.getSetting('trends_path') || ''
  if (!path) return res.status(400).json({ error: 'Renseigne le chemin de l’endpoint (ex. /trending/hashtags).' })
  try {
    const tags = await fetchTikTokTrends(key, host, path)
    res.json({ tags, count: tags.length })
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
}))

app.get('/api/music', wrap((_req, res) => res.json({ tracks: musicTracks() })))
app.post('/api/music', musicUpload.single('file'), wrap((req, res) => {
  const f = (req as Request & { file?: Express.Multer.File }).file
  if (!f) return res.status(400).json({ error: 'Fichier manquant' })
  res.json({ ok: true, name: f.filename }) // nom stocké sur disque → auto-sélection côté client
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
    await new Anthropic({ apiKey: key, maxRetries: 5 }).models.list()
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

// Vue d'ensemble des fournisseurs externes : état (configuré ou non) en un appel.
app.get('/api/providers', wrap((_req, res) => {
  res.json({
    voiceProvider: repo.getSetting('voice_provider') || 'openai',
    seriesEngine: repo.getSetting('series_video_engine') || 'seedance',
    providers: {
      claude: hasApiKey(),
      openai: !!getEncrypted('openai_key'),
      elevenlabs: !!getEncrypted('elevenlabs_key'),
      gemini: !!getEncrypted('gemini_key'),
      fal: !!getEncrypted('fal_key'),
      groq: !!getEncrypted('groq_key'),
      rapidapi: !!getEncrypted('rapidapi_key'),
      uploadpost: !!getEncrypted('uploadpost_key'),
      cookies: !!(repo.getSetting('ytdlp_cookies_file') || '').trim(),
      proxy: !!(process.env.DOWNLOAD_PROXY || '').trim()
    }
  })
}))

// Analyse IA de la croissance : rassemble les VRAIES stats (comptes + titres) et
// les fait analyser par Claude → diagnostic + recommandations classées. Mise en
// cache 20 min (appel coûteux) ; `force` pour rafraîchir.
let analyzeCache: { at: number; data: Record<string, unknown> } | null = null
app.post('/api/analyze', wrap(async (req, res) => {
  const apiKey = getApiKey()
  if (!apiKey) return res.status(400).json({ error: 'Configure d’abord ta clé Claude dans les Réglages.' })
  const force = (req.body as { force?: unknown })?.force === true
  if (!force && analyzeCache && Date.now() - analyzeCache.at < 20 * 60 * 1000) {
    return res.json({ ...analyzeCache.data, generatedAt: analyzeCache.at, cached: true })
  }
  const upKey = getEncrypted('uploadpost_key')
  const profiles = uploadPostProfiles()
  const comptes: Record<string, unknown>[] = []
  for (const u of profiles) {
    const a = upKey ? await fetchTikTokAnalytics(upKey, u) : {}
    const n = a.videoCount || 0
    comptes.push({
      compte: u,
      niche: nicheForProfile(u),
      abonnes: a.followers || 0,
      vues: a.views || 0,
      videos: n,
      likes: a.likes || 0,
      commentaires: a.comments || 0,
      partages: a.shares || 0,
      vuesParVideo: n ? Math.round((a.views || 0) / n) : 0,
      derniers14j: (a.timeseries || []).slice(-14).map((t) => `${t.date.slice(5)}:${t.value}`).join(' ')
    })
  }
  const clips = repo.listClips()
  const titresRecents: Record<string, string[]> = {}
  for (const u of profiles) {
    titresRecents[u] = clips.filter((c) => c.profile === u && c.publishStatus === 'published').slice(0, 15).map((c) => c.title || '').filter(Boolean)
  }
  const data = {
    contexte:
      'Cliperr : 5 comptes TikTok faceless 100% automatises (video IA : images + voix off TTS + sous-titres, ~20-28s ; series via Veo). Comptes jeunes (~1 mois). Publication auto via upload-post. On cherche a depasser ~300 vues/video (plafond = echec du 2e palier de push : hook OK mais completion/commentaires/PARTAGES ~0). derniers14j = vues par jour recentes (revele les comptes qui tombent a 0).',
    comptes,
    titresRecents
  }

  const tool = {
    name: 'rendu_analyse',
    description: 'Rend une analyse de croissance TikTok structuree et actionnable.',
    input_schema: {
      type: 'object',
      properties: {
        diagnostic: { type: 'string', description: 'Diagnostic global en 2-3 phrases : etat des comptes, pourquoi ils plafonnent ou decollent (base sur CES chiffres).' },
        levierPrincipal: { type: 'string', description: 'LE levier n°1 a plus fort impact pour depasser 1000 vues, en 1-2 phrases.' },
        recommandations: {
          type: 'array',
          description: '4 a 7 actions concretes, classees de la plus a la moins impactante.',
          items: {
            type: 'object',
            properties: {
              titre: { type: 'string' },
              detail: { type: 'string', description: 'Action precise et specifique (pas de generalite), ancree dans les donnees.' },
              impact: { type: 'string', enum: ['fort', 'moyen', 'faible'] },
              type: { type: 'string', enum: ['systeme', 'manuel'], description: 'systeme = reglable dans Cliperr (prompt, cadence, voix, CTA…) ; manuel = action humaine sur TikTok.' }
            },
            required: ['titre', 'detail', 'impact', 'type']
          }
        },
        aArreter: { type: 'array', items: { type: 'string' }, description: 'Ce qu il faut ARRETER de faire (gaspillages, mauvaises pratiques).' }
      },
      required: ['diagnostic', 'levierPrincipal', 'recommandations', 'aArreter']
    }
  } satisfies Anthropic.Tool

  const prompt = `Tu es un stratege de croissance TikTok expert, brutalement honnete et specialiste du contenu faceless/IA. Voici les VRAIES statistiques d un projet de 5 comptes :

${JSON.stringify(data, null, 1)}

Analyse RIGOUREUSEMENT ces chiffres reels (cite les comptes/titres precis, pas de generalites). Reperes : le format des titres qui performe vs plafonne, les comptes qui montent vs qui tombent a 0, la conversion abonnes, l engagement (commentaires/partages), la repetition de format. Rends une analyse concrete et priorisee via l outil rendu_analyse. En francais, tutoiement, direct.`

  const client = new Anthropic({ apiKey, maxRetries: 5 })
  const model = scriptModel()
  const msg = await client.messages.create({
    model,
    max_tokens: 3000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'rendu_analyse' },
    messages: [{ role: 'user', content: prompt }]
  })
  if (msg.usage) addSpend(model, { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens })
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return res.status(502).json({ error: 'Analyse indisponible — réessaie.' })
  const out = block.input as Record<string, unknown>
  analyzeCache = { at: Date.now(), data: out }
  res.json({ ...out, generatedAt: analyzeCache.at, cached: false })
}))

// Clé ElevenLabs (voix off humaines, alternative au TTS OpenAI)
app.get('/api/settings/elevenlabs', wrap((_req, res) => res.json({ has: !!getEncrypted('elevenlabs_key') })))
app.post('/api/settings/elevenlabs', wrap(async (req, res) => {
  const key = String(req.body?.key ?? '')
  setEncrypted('elevenlabs_key', key)
  // Auto-sélectionne une voix par défaut (1re du compte) pour ne pas retomber sur OpenAI.
  if (key) {
    try {
      const voices = await listElevenVoices(key)
      if (voices[0]) repo.setSetting('elevenlabs_default_voice', voices[0].id)
    } catch {
      /* clé invalide → l'utilisateur verra la liste vide */
    }
  }
  res.json({ ok: true })
}))

// Clé RapidAPI (téléchargement vidéo côté serveur, contourne le blocage YouTube)
app.get('/api/settings/rapidapi', wrap((_req, res) => res.json({ has: !!getEncrypted('rapidapi_key') })))
app.post('/api/settings/rapidapi', wrap((req, res) => {
  setEncrypted('rapidapi_key', String(req.body?.key ?? ''))
  res.json({ ok: true })
}))

// Cookies YouTube (fichier Netscape cookies.txt exporté depuis un navigateur
// connecté). Indispensable pour télécharger depuis le VPS : YouTube exige une
// session pour lever le « Sign in to confirm you're not a bot ». Combinés au PO
// token bgutil, ils débloquent yt-dlp côté serveur.
const cookiesPath = join(paths.data, 'yt-cookies.txt')
const cookiesUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, paths.data),
    filename: (_req, _file, cb) => cb(null, 'yt-cookies.txt')
  }),
  limits: { fileSize: 2 * 1024 * 1024 }
})
app.get('/api/settings/cookies', wrap((_req, res) => res.json({ has: existsSync(cookiesPath) })))
app.post('/api/settings/cookies', cookiesUpload.single('file'), wrap((req, res) => {
  const f = (req as Request & { file?: Express.Multer.File }).file
  if (!f) return res.status(400).json({ error: 'Fichier manquant' })
  const content = readFileSync(cookiesPath, 'utf8')
  if (!/youtube\.com/i.test(content)) {
    rmSync(cookiesPath, { force: true })
    return res.status(400).json({
      error:
        'Ce fichier ne ressemble pas à des cookies YouTube (aucun domaine youtube.com). ' +
        'Exporte bien les cookies depuis une page youtube.com connectée, au format « Netscape ».'
    })
  }
  repo.setSetting('ytdlp_cookies_file', cookiesPath)
  emitLog('Cookies YouTube enregistrés ✅ — les téléchargements de clips vont pouvoir passer.')
  res.json({ ok: true })
}))
app.delete('/api/settings/cookies', wrap((_req, res) => {
  if (existsSync(cookiesPath)) rmSync(cookiesPath, { force: true })
  repo.setSetting('ytdlp_cookies_file', '')
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
  res.json({ profiles: stickyProfileMeta(await listUploadPostProfiles(key)) })
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
  const cron = repo.getSetting('schedule_cron') || '*/30 * * * *'
  const lastRunAt = Number(repo.getSetting('schedule_last_run')) || null
  let nextRunAt: number | null = null
  let intervalSec: number | null = null
  if (enabled) {
    const n1 = cronNext(cron, new Date())
    if (n1) {
      nextRunAt = n1.getTime()
      const n2 = cronNext(cron, n1)
      if (n2) intervalSec = Math.round((n2.getTime() - n1.getTime()) / 1000)
    }
  }
  res.json({ enabled, cron, nextRunAt, intervalSec, lastRunAt })
}))

// Pilote automatique : contenu quotidien par compte selon sa niche
app.get('/api/autopilot', wrap(async (_req, res) => {
  const profiles = uploadPostProfiles()
  const meta = new Map((await cachedUploadPostProfiles()).map((p) => [p.username, p]))
  const today = dayKey()
  const niches = autopilotNiches()
  const seriesMap = autopilotSeries()
  const globalPerDay = Math.max(1, Number(repo.getSetting('autopilot_per_day')) || 1)
  const pdMap = perDayMap()
  const musicMap = profileMusic()
  const voiceMap = profileVoice()
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
        ctas: ctaMapForProfile(u),
        music: (musicMap[u] ?? []).filter((t) => typeof t === 'string'),
        voice: OPENAI_VOICES.includes(voiceMap[u]) ? voiceMap[u] : '',
        clipChannels: (clipChannelsMap()[u] ?? '').trim(),
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
// Planning du jour : vidéos DÉJÀ publiées (heure réelle) + À VENIR, aux heures
// FIXES du planning (dailySchedule) — la même source que le pilote.
app.get('/api/autopilot/plan', wrap(async (req, res) => {
  const enabled = repo.getSetting('autopilot_enabled') === '1'
  const perDay = Math.max(1, Number(repo.getSetting('autopilot_per_day')) || 1)
  const profiles = uploadPostProfiles()
  const n = profiles.length
  // day=0 (défaut) : aujourd'hui (déjà publiées + à venir). day=1+ : journée VIERGE à venir
  // (aucune vidéo publiée ce jour-là → compteurs vides → tout est « à venir »).
  const dayOffset = Math.max(0, Math.min(6, Math.round(Number((req.query as { day?: string }).day) || 0)))
  const { hm: realNowHm } = parisClock()
  const nowHm = dayOffset > 0 ? 0 : realNowHm // un jour futur n'a pas d'« heure actuelle »
  const win = { start: PUB_START_HOUR, end: PUB_END_HOUR }
  if (!n) return res.json({ enabled, perDay, window: win, nowHm, day: dayOffset, accounts: [], slots: [] })
  const meta = new Map((await cachedUploadPostProfiles()).map((p) => [p.username, p]))
  const today = dayKey(dayOffset)
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
    credits?: number
    failed?: boolean
    error?: string
    music?: string
  }
  const slots: Slot[] = []
  const ovToday = slotOverrides()

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
    // Ordinaux RÉELLEMENT faits (un bloc épinglé peut s'exécuter hors ordre :
    // doneord = [1,2,4] avec le 3 encore à venir). Émettre 1..done créerait une
    // collision d'ordinal avec le créneau restant → deux blocs de même clé côté
    // UI, et des blocs fantômes qui s'accumulent à chaque re-rendu.
    let doneArr: number[] = []
    try {
      const p = JSON.parse(repo.getSetting(`autopilot_doneord_${user}_${today}`) || '[]')
      if (Array.isArray(p)) doneArr = p.filter((n): n is number => typeof n === 'number')
    } catch {
      /* ignore */
    }
    const doneSet = new Set(doneArr)
    for (let j = 1; doneSet.size < done && j <= perDayForProfile(user); j++) doneSet.add(j) // rétro-compat
    const doneOrds = [...doneSet].sort((a, b) => a - b)
    doneOrds.forEach((ord, idx) => {
      const t = times[idx]
      const pp = t ? parisPartsOf(t.at) : null
      // Pour les publiées : on affiche le TITRE RÉEL de la vidéo (pas la config
      // actuelle du compte, qui a pu changer depuis — ex. passage en mode série).
      slots.push({
        ...info,
        niche: t?.title || info.niche,
        ordinal: ord,
        etaHm: pp ? pp.hm : 0,
        eta: pp ? pp.label : '—',
        done: true,
        credits: estimateCredits(ovToday[`${user}:${ord}`]?.type)
      })
    })
  })

  // Créneaux EN ÉCHEC aujourd'hui : écartés de la production (retentés demain), mais
  // AFFICHÉS avec leur erreur — et retirés du « à venir » pour ne pas être recomptés.
  const failedOf = (u: string): Record<string, string> => {
    try {
      const o = JSON.parse(repo.getSetting(`autopilot_failed_${u}_${today}`) || '{}')
      if (o && typeof o === 'object') return o as Record<string, string>
    } catch {
      /* ignore */
    }
    return {}
  }
  profiles.forEach((user) => {
    const m = meta.get(user)
    const confSerie = seriesConfiguredFor(user)
    for (const [ordStr, error] of Object.entries(failedOf(user))) {
      const ordinal = Number(ordStr)
      const ov = ovToday[`${user}:${ordinal}`]
      let label: string
      if (ov?.type === 'custom' && (ov.subject ?? '').trim()) label = `Sujet : ${(ov.subject ?? '').trim()}`
      else if (ov?.type === 'carousel' || ov?.type === 'slideshow') label = `${ov.type === 'slideshow' ? 'Diaporama' : 'Carrousel'} : ${(ov.subject ?? '').trim() || nicheForProfile(user)}`
      else if (ov?.type === 'stock') label = `En stock : ${repo.getClip(Number(ov.subject))?.title ?? `clip n°${ov.subject}`}`
      else if (ov?.type === 'clip') label = `Clip : ${(ov.subject ?? '').trim().replace(/^https?:\/\/(www\.)?/, '').slice(0, 50) || 'choix auto (IA)'}`
      else if (ov?.type === 'serie' && confSerie) label = `Série : ${confSerie.title}`
      else label = nicheForProfile(user)
      slots.push({
        user,
        handle: m?.tiktokHandle ?? null,
        avatarUrl: m?.avatarUrl ?? null,
        niche: label,
        ordinal,
        etaHm: ov?.hm != null ? ov.hm : 0,
        eta: ov?.hm != null ? fmt(ov.hm) : '—',
        done: false,
        pinned: ov?.hm != null,
        type: ov?.type,
        subject: ov?.subject,
        hasSeries: !!confSerie,
        credits: estimateCredits(ov?.type),
        music: ov?.music,
        failed: true,
        error
      })
    }
  })

  // À venir : on prend les heures du planning FIXE, la même source que le pilote
  // → l'heure affichée est EXACTEMENT celle à laquelle la vidéo partira.
  // Ordinaux encore à produire par compte (on saute ceux déjà faits — un bloc
  // épinglé a pu s'exécuter hors ordre — et ceux en échec).
  const pendingOrd = new Map<string, Set<number>>()
  profiles.forEach((u) => {
    let doneArr: number[] = []
    try {
      const p = JSON.parse(repo.getSetting(`autopilot_doneord_${u}_${today}`) || '[]')
      if (Array.isArray(p)) doneArr = p.filter((n): n is number => typeof n === 'number')
    } catch {
      /* ignore */
    }
    const set = new Set(doneArr)
    const cnt = Number(repo.getSetting(`autopilot_count_${u}_${today}`)) || 0
    for (let j = 1; set.size < cnt && j <= perDayForProfile(u); j++) set.add(j)
    for (const k of Object.keys(failedOf(u))) set.add(Number(k)) // échecs : ni faits, ni à re-produire aujourd'hui
    const list = new Set<number>()
    for (let j = 1; j <= perDayForProfile(u); j++) if (!set.has(j)) list.add(j)
    pendingOrd.set(u, list)
  })
  for (const sc of dailySchedule(today)) {
    if (!pendingOrd.get(sc.user)?.has(sc.ordinal)) continue
    const m = meta.get(sc.user)
    const ov = ovToday[`${sc.user}:${sc.ordinal}`]
    const confSerie = seriesConfiguredFor(sc.user)
    // Libellé selon le type du créneau (niche par défaut).
    let label: string
    if (ov?.type === 'custom' && (ov.subject ?? '').trim()) label = `Sujet : ${(ov.subject ?? '').trim()}`
    else if (ov?.type === 'carousel' || ov?.type === 'slideshow') label = `${ov.type === 'slideshow' ? 'Diaporama' : 'Carrousel'} : ${(ov.subject ?? '').trim() || nicheForProfile(sc.user)}`
    else if (ov?.type === 'stock') label = `En stock : ${repo.getClip(Number(ov.subject))?.title ?? `clip n°${ov.subject}`}`
    else if (ov?.type === 'clip') label = `Clip : ${(ov.subject ?? '').trim().replace(/^https?:\/\/(www\.)?/, '').slice(0, 50) || 'choix auto (IA)'}`
    else if (ov?.type === 'serie' && confSerie) label = `Série : ${confSerie.title} — Ép. ${confSerie.episode}`
    else label = nicheForProfile(sc.user)
    slots.push({
      user: sc.user,
      handle: m?.tiktokHandle ?? null,
      avatarUrl: m?.avatarUrl ?? null,
      niche: label,
      ordinal: sc.ordinal,
      etaHm: sc.hm,
      eta: fmt(sc.hm),
      done: false,
      pinned: sc.pinned,
      type: ov?.type,
      subject: ov?.subject,
      hasSeries: !!confSerie,
      credits: estimateCredits(ov?.type),
      music: ov?.music
    })
  }

  slots.sort((a, b) => a.etaHm - b.etaHm)
  // Cible du jour AFFICHÉ : les blocs différés (`from` futur) n'y comptent pas.
  const targetPerDay = dailySchedule(today).length
  // Tous les comptes configurés, même ceux à 0 vidéo/jour → l'UI affiche une ligne
  // par compte pour pouvoir en réactiver un qui n'a aucune vidéo prévue.
  const ord = accountOrder()
  const rank = (u: string): number => {
    const i = ord.indexOf(u)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i // compte jamais réordonné → à la fin
  }
  const accounts = profiles
    .map((user) => {
      const m = meta.get(user)
      // perDay : cadence RÉELLE du compte — la vue du jour peut masquer des blocs
      // différés, le « + » du client a besoin du vrai chiffre pour incrémenter.
      return { user, handle: m?.tiktokHandle ?? null, avatarUrl: m?.avatarUrl ?? null, perDay: perDayForProfile(user) }
    })
    .sort((a, b) => rank(a.user) - rank(b.user))
  res.json({ enabled, perDay, targetPerDay, window: win, nowHm, today, day: dayOffset, accounts, slots })
}))
// Réglages d'UN SEUL compte (fusion dans les maps existantes — pas de remplacement
// global) : utilisé par la fenêtre ⚙️ des lignes du planning.
app.post('/api/autopilot/account', wrap((req, res) => {
  const b = (req.body ?? {}) as { user?: unknown; perDay?: unknown; niche?: unknown; ctas?: unknown; music?: unknown; voice?: unknown; clipChannels?: unknown; series?: unknown }
  const user = String(b.user ?? '').trim()
  if (!user || !uploadPostProfiles().includes(user)) return res.status(400).json({ error: 'Compte inconnu' })
  if (b.voice !== undefined) {
    const v = String(b.voice ?? '').trim()
    const m = profileVoice()
    // Voix OpenAI OU id de voix ElevenLabs (alphanumérique) : sans ce second cas,
    // choisir une voix ElevenLabs sur un compte l'effaçait silencieusement.
    if (v && (OPENAI_VOICES.includes(v) || /^[A-Za-z0-9]{12,48}$/.test(v))) m[user] = v
    else delete m[user] // vide / inconnue → voix par défaut
    repo.setSetting('profile_voice', JSON.stringify(m))
  }
  if (Array.isArray(b.music)) {
    // Playlist du compte : on ne garde que des pistes réellement présentes.
    const avail = musicTracks()
    const list = (b.music as unknown[]).map(String).filter((t) => avail.includes(t)).slice(0, 50)
    const m = profileMusic()
    if (list.length) m[user] = list
    else delete m[user]
    repo.setSetting('profile_music', JSON.stringify(m))
    repo.setSetting(`music_idx_${user}`, '0') // playlist modifiée → rotation repart au début
  }
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
  if (b.ctas && typeof b.ctas === 'object') {
    const m = profileCtas()
    const map: { niche?: string; serie?: string; custom?: string; clip?: string } = {}
    for (const t of ['niche', 'serie', 'custom', 'clip'] as const) {
      const val = (b.ctas as Record<string, unknown>)[t]
      if (typeof val === 'string' && val.trim()) map[t] = val.trim().slice(0, 220)
    }
    if (Object.keys(map).length) m[user] = map
    else delete m[user]
    repo.setSetting('profile_ctas', JSON.stringify(m))
  }
  if (typeof b.clipChannels === 'string') {
    const m = clipChannelsMap()
    if (b.clipChannels.trim()) m[user] = b.clipChannels.trim().slice(0, 500)
    else delete m[user]
    repo.setSetting('clip_channels', JSON.stringify(m))
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

/**
 * Fournisseur déduit de la VOIX elle-même : un id ElevenLabs n'est pas une voix
 * OpenAI. Permet de choisir une voix ElevenLabs sur un compte sans toucher au
 * réglage global.
 */
function providerForVoice(voice: string): 'openai' | 'elevenlabs' {
  return voice && !OPENAI_VOICES.includes(voice) ? 'elevenlabs' : 'openai'
}
// Voix disponibles pour le sélecteur par compte : les voix OpenAI ET, si la clé
// ElevenLabs est présente, celles du compte ElevenLabs — dans une seule liste.
app.get('/api/tts/voices', wrap(async (_req, res) => {
  const openai = OPENAI_VOICES.map((v) => ({ id: v, label: v, provider: 'openai' as const }))
  const key = getEncrypted('elevenlabs_key')
  if (!key) return res.json({ voices: openai, elevenlabs: false })
  try {
    const el = await listElevenVoices(key)
    res.json({
      voices: [...openai, ...el.map((v) => ({ id: v.id, label: v.name, provider: 'elevenlabs' as const }))],
      elevenlabs: true
    })
  } catch (e) {
    res.json({ voices: openai, elevenlabs: false, error: e instanceof Error ? e.message : String(e) })
  }
}))
// Aperçu d'une voix : renvoie un court extrait mp3 (bouton « Écouter » des réglages).
app.get('/api/tts/preview', wrap(async (req, res) => {
  const voice = String(req.query.voice ?? '').trim()
  const openaiKey = getEncrypted('openai_key')
  const elevenKey = getEncrypted('elevenlabs_key')
  // Le fournisseur découle de la voix demandée (même règle qu'à la génération).
  const provider = providerForVoice(voice) === 'elevenlabs' && elevenKey ? 'elevenlabs' : 'openai'
  if (provider === 'openai' && !OPENAI_VOICES.includes(voice)) {
    return res.status(400).json({ error: elevenKey ? 'Voix inconnue' : 'Voix ElevenLabs : ajoute d’abord la clé ElevenLabs dans les Réglages.' })
  }
  if (provider === 'openai' && !openaiKey) return res.status(400).json({ error: 'Clé OpenAI manquante (Réglages).' })
  if (provider === 'elevenlabs' && !voice) return res.status(400).json({ error: 'Choisis une voix.' })
  try {
    const buf = await ttsPreview(voice, { openaiKey: openaiKey || '', provider, elevenKey })
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
}))

// Test de compatibilité des chaînes préférées (catégorie Clip) : pour chaque
// chaîne, vérifie qu'elle est trouvable, qu'elle a des vidéos longues (15-120 min)
// et que ses vidéos sont téléchargeables (pas de protection).
app.post('/api/autopilot/clip-channels/test', wrap(async (req, res) => {
  const raw = String((req.body as { channels?: unknown })?.channels ?? '')
  const channels = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
  const key = getEncrypted('rapidapi_key')
  if (!key) return res.status(400).json({ error: 'Clé RapidAPI manquante (Réglages).' })
  if (!channels.length) return res.status(400).json({ error: 'Aucune chaîne à tester.' })
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const results: { channel: string; status: string; videos: number; longCount: number; sample?: string }[] = []
  for (const ch of channels) {
    try {
      const found = await searchYouTubeVideos(key, ch)
      const mine = found.filter(
        (v) => v.channel && (norm(v.channel).includes(norm(ch)) || norm(ch).includes(norm(v.channel)))
      )
      if (!mine.length) {
        results.push({ channel: ch, status: 'introuvable', videos: 0, longCount: 0 })
        continue
      }
      const long = mine.filter((v) => v.durationSec != null && v.durationSec >= 15 * 60 && v.durationSec <= 120 * 60)
      const target = long[0] ?? mine[0]
      const downloadable = await probeDownloadable(key, target.id)
      results.push({
        channel: ch,
        status: !downloadable ? 'protege' : long.length ? 'ok' : 'aucune_longue',
        videos: mine.length,
        longCount: long.length,
        sample: target.title
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ channel: ch, status: /429|quota/i.test(msg) ? 'quota' : 'erreur', videos: 0, longCount: 0 })
    }
  }
  res.json({ results })
}))

// Personnalise un créneau du jour (heure et/ou type) — clic sur un bloc du planning.
app.post('/api/autopilot/slot', wrap((req, res) => {
  const b = (req.body ?? {}) as { user?: unknown; ordinal?: unknown; hm?: unknown; type?: unknown; subject?: unknown; music?: unknown; reset?: unknown; day?: unknown }
  const user = String(b.user ?? '').trim()
  const ordinal = Math.max(1, Math.round(Number(b.ordinal)) || 1)
  if (!user || !uploadPostProfiles().includes(user)) return res.status(400).json({ error: 'Compte inconnu' })
  const map = slotOverrides()
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
      } else if (['niche', 'serie', 'custom', 'clip', 'carousel', 'slideshow', 'stock'].includes(t)) {
        o.type = t
      }
    }
    if (b.subject !== undefined) {
      const s = String(b.subject ?? '').trim().slice(0, 300)
      if (s) o.subject = s
      else delete o.subject
    }
    if (b.music !== undefined) {
      const mu = String(b.music ?? '').trim()
      if (mu && mu !== 'auto') o.music = mu.slice(0, 120) // nom de fichier précis, ou 'none'
      else delete o.music // 'auto' → l'IA choisit la musique
    }
    // Bloc créé depuis l'onglet « Demain » (day=1) : il ne prend vie que demain.
    // Sans ça, le modèle vaudrait aussi pour AUJOURD'HUI et le rattrapage lancerait
    // le soir même tout bloc dont l'heure du jour est déjà passée.
    if (Number(b.day) >= 1) o.from = dayKey(1)
    if (o.hm == null && !o.type && !o.music && !o.from) delete map[key]
    else map[key] = o
  }
  // Modèle persistant : appliqué chaque jour tant qu'il n'est pas modifié.
  repo.setSetting('autopilot_slot_overrides', JSON.stringify(map))
  // Éditer un créneau efface son échec du jour → il peut être RETENTÉ aujourd'hui.
  try {
    const fk = `autopilot_failed_${user}_${dayKey()}`
    const fm = JSON.parse(repo.getSetting(fk) || '{}') as Record<string, unknown>
    if (fm && typeof fm === 'object' && fm[String(ordinal)] != null) {
      delete fm[String(ordinal)]
      repo.setSetting(fk, JSON.stringify(fm))
    }
  } catch {
    /* ignore */
  }
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
