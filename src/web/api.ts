import type { SourceDTO, ClipDTO, ProgressEvent, ViralIdea, SavedIdea } from '../shared/types'

export type { SourceDTO, ClipDTO, ProgressEvent, ViralIdea, SavedIdea }

export interface PublishOverrides {
  caption?: string
  privacyLevel?: string
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  brandOrganic?: boolean
  brandContent?: boolean
  uploadPostUser?: string
}


async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts
  })
  if (res.status === 401) throw new Error('unauthenticated')
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json as T
}

const post = <T>(p: string, body?: unknown): Promise<T> =>
  req<T>(p, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) })

export const api = {
  // Auth
  me: () => req<{ authed: boolean }>('/api/me'),
  login: (password: string) => post('/api/login', { password }),
  logout: () => post('/api/logout'),

  // Sources / clips
  listSources: () => req<SourceDTO[]>('/api/sources'),
  addSource: (url: string) => post<SourceDTO>('/api/sources', { url }),
  uploadSource: (file: File, onProgress?: (ratio: number) => void) =>
    new Promise<SourceDTO>((resolve, reject) => {
      const fd = new FormData()
      fd.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/sources/upload')
      xhr.withCredentials = true
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
      xhr.onload = () => {
        try {
          const j = JSON.parse(xhr.responseText || '{}')
          xhr.status >= 200 && xhr.status < 300 ? resolve(j) : reject(new Error(j?.error || `HTTP ${xhr.status}`))
        } catch (e) {
          reject(e)
        }
      }
      xhr.onerror = () => reject(new Error('Upload échoué'))
      xhr.send(fd)
    }),
  listClips: (sourceId?: number) =>
    req<ClipDTO[]>(`/api/clips${sourceId ? `?sourceId=${sourceId}` : ''}`),
  reviewClip: (id: number, status: ClipDTO['reviewStatus']) => post(`/api/clips/${id}/review`, { status }),
  publishClip: (id: number, overrides?: PublishOverrides) =>
    post(`/api/clips/${id}/publish`, { overrides }),
  runPipeline: (sourceId: number, clipCount: number) => post('/api/pipeline/run', { sourceId, clipCount }),

  // Publication : profil actif + état du quota
  publishState: () =>
    req<{
      mode: string
      profiles: { username: string; handle: string | null; avatarUrl: string | null }[]
      active: string
      quotaReached: boolean
      quotaProfile: string | null
    }>('/api/publish/state'),

  // Idées virales + tendances
  generateIdeas: (niche: string, count: number, trends: string[]) =>
    post<{ ideas: SavedIdea[] }>('/api/ideas', { niche, count, trends }),
  savedIdeas: () => req<{ ideas: SavedIdea[] }>('/api/ideas/saved'),
  deleteIdea: (id: number) => req(`/api/ideas/${id}`, { method: 'DELETE' }),
  generateIdeaVideo: (id: number) => post(`/api/ideas/${id}/video`),
  openaiStatus: () => req<{ has: boolean }>('/api/settings/openai'),
  setOpenaiKey: (key: string) => post('/api/settings/openai', { key }),
  musicList: () => req<{ tracks: string[] }>('/api/music'),
  uploadMusic: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ ok: boolean }>('/api/music', { method: 'POST', body: fd })
  },
  deleteMusic: (name: string) => req(`/api/music/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  trends: () => req<{ configured: boolean; hashtags: string[]; error?: string }>('/api/trends'),

  // Réglages
  getFlag: (key: string) => req<{ value: string | null }>(`/api/settings/flag/${encodeURIComponent(key)}`),
  setFlag: (key: string, value: string) => post('/api/settings/flag', { key, value }),
  apiKeyStatus: () => req<{ has: boolean; masked: string | null }>('/api/settings/apikey'),
  setApiKey: (key: string) => post('/api/settings/apikey', { key }),
  clearApiKey: () => req('/api/settings/apikey', { method: 'DELETE' }),
  validateKey: () => req<{ connected: boolean; masked: string | null; error?: string }>('/api/settings/validate'),
  spend: () => req<{ usd: number; inTokens: number; outTokens: number }>('/api/settings/spend'),
  resetSpend: () => post('/api/settings/spend/reset'),
  groqStatus: () => req<{ has: boolean }>('/api/settings/groq'),
  setGroqKey: (key: string) => post('/api/settings/groq', { key }),
  rapidApiStatus: () => req<{ has: boolean }>('/api/settings/rapidapi'),
  setRapidApiKey: (key: string) => post('/api/settings/rapidapi', { key }),
  uploadPostStatus: () => req<{ has: boolean }>('/api/settings/uploadpost'),
  setUploadPostKey: (key: string) => post('/api/settings/uploadpost', { key }),
  uploadPostProfiles: () =>
    req<{ profiles: { username: string; tiktokHandle: string | null; tiktokConnected: boolean; reauthRequired: boolean; blocked: boolean }[] }>(
      '/api/uploadpost/profiles'
    ),

  // yt-dlp / scheduler
  updateYtDlp: () => post('/api/ytdlp/update'),
  installPot: () => post('/api/ytdlp/install-pot'),
  reloadScheduler: () => post('/api/scheduler/reload'),
  schedulerStatus: () =>
    req<{ enabled: boolean; paused: boolean; cron: string; nextRunAt: number | null; intervalSec: number | null; lastRunAt: number | null }>(
      '/api/scheduler/status'
    ),

  // TikTok
  tiktokStatus: () => req<{ connected: boolean; hasConfig: boolean; hasSecret: boolean }>('/api/tiktok/status'),
  tiktokProfile: () =>
    req<{ connected: boolean; nickname: string | null; username: string | null; avatarUrl: string | null }>(
      '/api/tiktok/profile'
    ),
  tiktokAuthUrl: () => req<{ url: string }>('/api/tiktok/authurl'),
  tiktokSubmitCode: (code: string) => post('/api/tiktok/code', { code }),
  tiktokCheck: () =>
    post<{
      nickname: string | null
      username: string | null
      avatarUrl: string | null
      privacyOptions: string[]
      maxDurationSec: number | null
      commentDisabled: boolean
      duetDisabled: boolean
      stitchDisabled: boolean
    }>('/api/tiktok/check'),
  tiktokSetSecret: (secret: string) => post('/api/tiktok/secret', { secret }),
  tiktokDisconnect: () => post('/api/tiktok/disconnect')
}

/** Flux temps réel (progression pipeline + journaux). */
export function subscribe(handlers: {
  onProgress?: (e: ProgressEvent) => void
  onLog?: (m: string) => void
  onIdeaVideo?: (e: { ideaId: number; status: 'running' | 'done' | 'error'; message: string }) => void
}): () => void {
  const es = new EventSource('/api/events')
  es.addEventListener('progress', (ev) => handlers.onProgress?.(JSON.parse((ev as MessageEvent).data)))
  es.addEventListener('log', (ev) => handlers.onLog?.(JSON.parse((ev as MessageEvent).data).message))
  es.addEventListener('ideavideo', (ev) => handlers.onIdeaVideo?.(JSON.parse((ev as MessageEvent).data)))
  return () => es.close()
}

export function clipUrl(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return `/media/clips/${encodeURIComponent(base)}`
}
