import { contextBridge, ipcRenderer } from 'electron'
import type { SourceDTO, ClipDTO, ProgressEvent } from '../shared/types'

export interface PublishOverrides {
  caption?: string
  privacyLevel?: string
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  brandOrganic?: boolean
  brandContent?: boolean
}

// API exposée au renderer. Unique point de contact UI ↔ main process.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),
  getVersions: (): Promise<{ node: string; electron: string; chrome: string }> =>
    ipcRenderer.invoke('app:versions'),

  addSource: (url: string): Promise<SourceDTO> => ipcRenderer.invoke('source:add', url),
  listSources: (): Promise<SourceDTO[]> => ipcRenderer.invoke('source:list'),
  listClips: (sourceId?: number): Promise<ClipDTO[]> => ipcRenderer.invoke('clip:list', sourceId),
  runPipeline: (sourceId: number, clipCount?: number): Promise<void> =>
    ipcRenderer.invoke('pipeline:run', sourceId, clipCount),

  reviewClip: (id: number, status: ClipDTO['reviewStatus']): Promise<void> =>
    ipcRenderer.invoke('clip:review', id, status),
  publishClip: (id: number, overrides?: PublishOverrides): Promise<void> =>
    ipcRenderer.invoke('clip:publish', id, overrides),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile'),
  pickVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickVideo'),
  updateYtDlp: (): Promise<void> => ipcRenderer.invoke('ytdlp:update'),
  installPotPlugin: (): Promise<void> => ipcRenderer.invoke('ytdlp:installPot'),
  reloadScheduler: (): Promise<void> => ipcRenderer.invoke('scheduler:reload'),

  tiktokStatus: (): Promise<{ connected: boolean; hasConfig: boolean; hasSecret: boolean }> =>
    ipcRenderer.invoke('tiktok:status'),
  tiktokSetClientSecret: (secret: string): Promise<void> =>
    ipcRenderer.invoke('tiktok:setClientSecret', secret),
  tiktokConnect: (): Promise<{ connected: boolean; openId: string }> =>
    ipcRenderer.invoke('tiktok:connect'),
  tiktokDisconnect: (): Promise<void> => ipcRenderer.invoke('tiktok:disconnect'),
  tiktokGetAuthUrl: (): Promise<string> => ipcRenderer.invoke('tiktok:getAuthUrl'),
  tiktokSubmitCode: (code: string): Promise<void> =>
    ipcRenderer.invoke('tiktok:submitCode', code),
  tiktokCheckCreator: (): Promise<{
    nickname: string | null
    username: string | null
    avatarUrl: string | null
    privacyOptions: string[]
    maxDurationSec: number | null
    commentDisabled: boolean
    duetDisabled: boolean
    stitchDisabled: boolean
  }> => ipcRenderer.invoke('tiktok:checkCreator'),
  tiktokGetProfile: (): Promise<{
    connected: boolean
    nickname: string | null
    username: string | null
    avatarUrl: string | null
  }> => ipcRenderer.invoke('tiktok:getProfile'),

  onPublishLog: (cb: (msg: string) => void): (() => void) => {
    const listener = (_: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('publish:log', listener)
    return () => ipcRenderer.removeListener('publish:log', listener)
  },

  openClipsFolder: (): Promise<string> => ipcRenderer.invoke('shell:openClips'),
  revealPath: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', key),
  clearApiKey: (): Promise<void> => ipcRenderer.invoke('settings:clearApiKey'),
  validateKey: (): Promise<{ connected: boolean; masked: string | null; error?: string }> =>
    ipcRenderer.invoke('settings:validateKey'),
  getSpend: (): Promise<{ usd: number; inTokens: number; outTokens: number }> =>
    ipcRenderer.invoke('settings:getSpend'),
  resetSpend: (): Promise<void> => ipcRenderer.invoke('settings:resetSpend'),
  getFlag: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:getFlag', key),
  setFlag: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('settings:setFlag', key, value),
  hasGroqKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasGroqKey'),
  setGroqKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setGroqKey', key),

  onProgress: (cb: (e: ProgressEvent) => void): (() => void) => {
    const listener = (_: unknown, payload: ProgressEvent): void => cb(payload)
    ipcRenderer.on('pipeline:progress', listener)
    return () => ipcRenderer.removeListener('pipeline:progress', listener)
  }
}

export type PreloadApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] exposeInMainWorld failed', error)
  }
} else {
  // @ts-ignore (contextIsolation désactivé — fallback de secours)
  window.api = api
}
