import { ipcMain, shell, dialog, type IpcMainInvokeEvent } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import {
  resolveBinaries,
  ensureWhisper,
  ensureFaceCascade,
  updateYtDlp,
  installPotPlugin
} from './binaries/manager'
import { runPipeline, type ReframeFocus } from './pipeline/orchestrator'
import { transcribeSource, transcribeWithGroq, type Word } from './pipeline/transcribe'
import { detectFaceCenterX } from './pipeline/face'
import type { PipelineContext } from './pipeline/context'
import type { Usage } from './pipeline/highlights'
import * as repo from './db/repo'
import {
  getApiKey,
  getApiKeyMasked,
  hasApiKey,
  setApiKey,
  clearApiKey,
  setEncrypted,
  getEncrypted
} from './secrets'
import {
  publishClipById,
  getTikTokConfig,
  clearTikTokTokens,
  tiktokConnected,
  getTikTokAuthUrl,
  submitTikTokCode,
  checkTikTokCreator,
  getTikTokProfile
} from './publish/service'
import type { PublishOverrides } from './publish/index'
import { reloadScheduler } from './scheduler'
import type { ClipDTO } from '../shared/types'
import type { AppPaths } from './paths'
import type { ProgressEvent } from '../shared/types'

const FLAG_TRANSCRIBE = 'transcribe_enabled'
const FLAG_TRANSCRIBE_BACKEND = 'transcribe_backend' // 'local' | 'groq'
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

// Prix par million de tokens (entrée/sortie).
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 }
}

function addSpend(model: string, usage: Usage): void {
  const p = PRICES[model] ?? PRICES['claude-haiku-4-5']
  const cost = (usage.input_tokens * p.in + usage.output_tokens * p.out) / 1_000_000
  repo.setSetting(SPEND_USD, String((parseFloat(repo.getSetting(SPEND_USD) ?? '0') || 0) + cost))
  repo.setSetting(
    SPEND_IN,
    String((parseInt(repo.getSetting(SPEND_IN) ?? '0', 10) || 0) + usage.input_tokens)
  )
  repo.setSetting(
    SPEND_OUT,
    String((parseInt(repo.getSetting(SPEND_OUT) ?? '0', 10) || 0) + usage.output_tokens)
  )
}

let ctxPromise: Promise<PipelineContext> | null = null

async function getContext(paths: AppPaths, onLog?: (m: string) => void): Promise<PipelineContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const bin = await resolveBinaries(paths.bin, onLog)
      return { bin, dirs: { downloads: paths.downloads, clips: paths.clips, bin: paths.bin } }
    })()
  }
  return ctxPromise
}

// File d'attente : un seul pipeline à la fois (évite de saturer CPU/RAM).
let pipelineChain: Promise<void> = Promise.resolve()

async function runPipelineForSource(
  paths: AppPaths,
  e: IpcMainInvokeEvent,
  sourceId: number,
  clipCount: number
): Promise<void> {
  const source = repo.getSource(sourceId)
  if (!source) throw new Error(`Source #${sourceId} introuvable`)

  const send = (ev: ProgressEvent): void => {
    if (!e.sender.isDestroyed()) e.sender.send('pipeline:progress', ev)
  }
  const log = (m: string): void =>
    send({ sourceId, stage: 'ingest', status: 'running', progress: 0, message: m })

  const apiKey = getApiKey()
  const model = MODEL_MAP[repo.getSetting(FLAG_MODEL) ?? 'haiku'] ?? MODEL_MAP.haiku
  const reframeFocus = (repo.getSetting(FLAG_REFRAME) as ReframeFocus) || 'center'
  const transcribeEnabled = repo.getSetting(FLAG_TRANSCRIBE) === '1'
  const backend = repo.getSetting(FLAG_TRANSCRIBE_BACKEND) || 'local'
  const groqKey = getEncrypted('groq_key')
  const cookiesFromBrowser = repo.getSetting('ytdlp_cookies_browser') || null
  const cookiesFile = repo.getSetting('ytdlp_cookies_file') || null

  repo.updateSource(sourceId, { status: 'running', error: null })
  try {
    const ctx = await getContext(paths, log)

    // Backend de transcription : Groq (cloud, rapide) si choisi + clé dispo, sinon whisper local.
    const transcribe: ((sourceFile: string, sid: number) => Promise<Word[]>) | null =
      !transcribeEnabled
        ? null
        : (sourceFile, sid) => {
            if (backend === 'groq' && groqKey)
              return transcribeWithGroq(ctx, groqKey, sourceFile, sid)
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
        onMeta: (m) =>
          repo.updateSource(sourceId, {
            title: m.title,
            author: m.author,
            durationSec: m.durationSec
          }),
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
      {
        apiKey,
        model,
        transcribe,
        reframeFocus,
        detectFace,
        cookiesFromBrowser,
        cookiesFile,
        clipCount
      }
    )
    repo.updateSource(sourceId, { status: 'done' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    repo.updateSource(sourceId, { status: 'error', error: msg })
    send({ sourceId, stage: 'ingest', status: 'error', progress: 0, message: msg })
    throw err
  }
}

export function registerIpc(paths: AppPaths): void {
  ipcMain.handle('app:ping', () => 'pong')
  ipcMain.handle('app:versions', () => ({
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }))

  ipcMain.handle('source:add', (_e, url: string) => repo.createSource(url))
  ipcMain.handle('source:list', () => repo.listSources())
  ipcMain.handle('clip:list', (_e, sourceId?: number) => repo.listClips(sourceId))

  ipcMain.handle('shell:openClips', () => shell.openPath(paths.clips))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

  ipcMain.handle('settings:hasApiKey', () => hasApiKey())
  ipcMain.handle('settings:setApiKey', (_e, key: string) => setApiKey(key))
  ipcMain.handle('settings:clearApiKey', () => clearApiKey())
  ipcMain.handle('settings:getFlag', (_e, key: string) => repo.getSetting(key))
  ipcMain.handle('settings:setFlag', (_e, key: string, value: string) =>
    repo.setSetting(key, value)
  )

  // Vérifie la validité de la clé via un appel gratuit (models.list, 0 token).
  ipcMain.handle('settings:validateKey', async () => {
    const key = getApiKey()
    const masked = getApiKeyMasked()
    if (!key) return { connected: false, masked: null }
    try {
      const client = new Anthropic({ apiKey: key })
      await client.models.list()
      return { connected: true, masked }
    } catch (e) {
      return { connected: false, masked, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('settings:getSpend', () => ({
    usd: parseFloat(repo.getSetting(SPEND_USD) ?? '0') || 0,
    inTokens: parseInt(repo.getSetting(SPEND_IN) ?? '0', 10) || 0,
    outTokens: parseInt(repo.getSetting(SPEND_OUT) ?? '0', 10) || 0
  }))
  ipcMain.handle('settings:resetSpend', () => {
    repo.setSetting(SPEND_USD, '0')
    repo.setSetting(SPEND_IN, '0')
    repo.setSetting(SPEND_OUT, '0')
  })

  // ── Validation / publication ────────────────────────────────────────────
  ipcMain.handle('clip:review', (_e, id: number, status: ClipDTO['reviewStatus']) =>
    repo.setClipReview(id, status)
  )

  ipcMain.handle('clip:publish', async (e, id: number, overrides?: PublishOverrides) => {
    const log = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('publish:log', m)
    }
    await publishClipById(id, paths, log, overrides)
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('ytdlp:update', async (e) => {
    const log = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('publish:log', m)
    }
    await updateYtDlp(paths.bin, log)
  })

  ipcMain.handle('ytdlp:installPot', async (e) => {
    const log = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('publish:log', m)
    }
    await installPotPlugin(paths.bin, log)
  })

  ipcMain.handle('dialog:pickFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:pickVideo', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('scheduler:reload', () => reloadScheduler(paths))

  // ── TikTok ──────────────────────────────────────────────────────────────
  ipcMain.handle('tiktok:setClientSecret', (_e, secret: string) =>
    setEncrypted('tiktok_client_secret', secret)
  )
  ipcMain.handle('tiktok:status', () => ({
    connected: tiktokConnected(),
    hasConfig: !!getTikTokConfig(),
    hasSecret: !!getEncrypted('tiktok_client_secret')
  }))
  ipcMain.handle('tiktok:disconnect', () => clearTikTokTokens())
  ipcMain.handle('tiktok:getProfile', () => getTikTokProfile())
  ipcMain.handle('tiktok:getAuthUrl', () => getTikTokAuthUrl())
  ipcMain.handle('tiktok:submitCode', (_e, code: string) => submitTikTokCode(code))
  ipcMain.handle('tiktok:checkCreator', () => checkTikTokCreator())

  // Clé Groq (transcription cloud)
  ipcMain.handle('settings:hasGroqKey', () => !!getEncrypted('groq_key'))
  ipcMain.handle('settings:setGroqKey', (_e, key: string) => setEncrypted('groq_key', key))

  // Pipeline : mis en file d'attente (un seul à la fois)
  ipcMain.handle('pipeline:run', (e, sourceId: number, clipCount?: number) => {
    const n = Math.min(10, Math.max(1, Math.round(clipCount ?? 3)))
    const job = pipelineChain.then(() => runPipelineForSource(paths, e, sourceId, n))
    pipelineChain = job.then(
      () => undefined,
      () => undefined
    )
    return job
  })
}
