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
  // Journal d'activité persistant (console). `before` = id exclusif → page plus ancienne.
  activity: (before?: number, limit = 200) =>
    req<{ id: number; message: string; createdAt: number }[]>(
      `/api/activity?limit=${limit}${before ? `&before=${before}` : ''}`
    ),

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
      scope: string
      quotaReached: boolean
      quotaProfile: string | null
    }>('/api/publish/state'),
  analytics: () =>
    req<{
      profiles: {
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
      }[]
    }>('/api/analytics'),
  analyticsPosts: (profile: string) =>
    req<{ posts: { clipId: number; title: string | null; filePath: string | null; postUrl: string | null; createdAt: number; views: number; likes: number; comments: number; shares: number }[] }>(
      `/api/analytics/posts?profile=${encodeURIComponent(profile)}`
    ),

  // Pilote automatique (contenu quotidien par compte)
  autopilotState: () =>
    req<{
      enabled: boolean
      perDay: number
      busy: boolean
      profiles: {
        username: string
        handle: string | null
        avatarUrl: string | null
        niche: string
        ctas: { niche?: string; serie?: string; custom?: string; clip?: string }
        music: string[]
        voice: string
        clipChannels: string
        perDay: number
        series: { enabled: boolean; title: string; universe: string; episode: number }
        doneToday: number
      }[]
    }>('/api/autopilot'),
  saveAutopilot: (cfg: {
    enabled?: boolean
    perDay?: number
    perDays?: Record<string, number>
    niches?: Record<string, string>
    ctas?: Record<string, string>
    series?: Record<string, { enabled: boolean; title: string; universe: string }>
  }) => post<{ ok: boolean }>('/api/autopilot', cfg),
  generateIdeaSlideshow: (id: number) => post<{ ok: boolean }>(`/api/ideas/${id}/slideshow`),
  runAutopilotNow: () => post<{ ok: boolean }>('/api/autopilot/run-now'),
  saveAccountOrder: (order: string[]) => post<{ ok: boolean }>('/api/autopilot/order', { order }),
  autopilotPlan: (day?: number) =>
    req<{
      enabled: boolean
      perDay: number
      targetPerDay?: number
      window: { start: number; end: number }
      nowHm: number
      today?: string
      day?: number
      accounts?: { user: string; handle: string | null; avatarUrl: string | null }[]
      slots: {
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
      }[]
    }>(`/api/autopilot/plan${day ? `?day=${day}` : ''}`),
  saveAutopilotSlot: (slot: { user: string; ordinal: number; hm?: number | null; type?: string | null; subject?: string | null; music?: string | null; reset?: boolean; day?: number }) =>
    post<{ ok: boolean }>('/api/autopilot/slot', slot),
  saveAutopilotAccount: (cfg: { user: string; perDay?: number; niche?: string; ctas?: { niche?: string; serie?: string; custom?: string; clip?: string }; music?: string[]; voice?: string; clipChannels?: string; series?: { enabled: boolean; title: string; universe: string } }) =>
    post<{ ok: boolean }>('/api/autopilot/account', cfg),
  testClipChannels: (channels: string) =>
    post<{ results: { channel: string; status: string; videos: number; longCount: number; sample?: string }[] }>('/api/autopilot/clip-channels/test', { channels }),

  // Idées virales + tendances
  generateIdeas: (niche: string, count: number, trends: string[]) =>
    post<{ ideas: SavedIdea[] }>('/api/ideas', { niche, count, trends }),
  inspireIdea: (url: string, niche: string, mode: 'reproduce' | 'inspire') => post<{ idea: SavedIdea }>('/api/ideas/inspire', { url, niche, mode }),
  savedIdeas: () => req<{ ideas: SavedIdea[] }>('/api/ideas/saved'),
  deleteIdea: (id: number) => req(`/api/ideas/${id}`, { method: 'DELETE' }),
  generateIdeaVideo: (id: number) => post(`/api/ideas/${id}/video`),
  openaiStatus: () => req<{ has: boolean }>('/api/settings/openai'),
  setOpenaiKey: (key: string) => post('/api/settings/openai', { key }),
  geminiStatus: () => req<{ has: boolean }>('/api/settings/gemini'),
  setGeminiKey: (key: string) => post('/api/settings/gemini', { key }),
  falStatus: () => req<{ has: boolean }>('/api/settings/fal'),
  setFalKey: (key: string) => post('/api/settings/fal', { key }),
  musicList: () => req<{ tracks: string[] }>('/api/music'),
  uploadMusic: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ ok: boolean; name?: string }>('/api/music', { method: 'POST', body: fd })
  },
  deleteMusic: (name: string) => req(`/api/music/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  trends: () => req<{ configured: boolean; hashtags: string[]; error?: string }>('/api/trends'),

  // Liens courts publics (bio TikTok)
  golinks: () => req<{ links: Record<string, string> }>('/api/golinks'),
  saveGolinks: (links: Record<string, string>) => post<{ ok: boolean; links: Record<string, string> }>('/api/golinks', { links }),

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
  providers: () =>
    req<{ voiceProvider: 'openai' | 'elevenlabs'; seriesEngine: string; providers: Record<string, boolean> }>('/api/providers'),
  analyze: (force?: boolean) =>
    post<{
      diagnostic: string
      levierPrincipal: string
      recommandations: { titre: string; detail: string; impact: 'fort' | 'moyen' | 'faible'; type: 'systeme' | 'manuel' }[]
      aArreter: string[]
      generatedAt?: number
      cached?: boolean
    }>('/api/analyze', { force }),
  elevenlabsStatus: () => req<{ has: boolean }>('/api/settings/elevenlabs'),
  setElevenlabsKey: (key: string) => post('/api/settings/elevenlabs', { key }),
  ttsVoices: () =>
    req<{
      voices: { id: string; label: string; provider: 'openai' | 'elevenlabs' }[]
      elevenlabs: boolean
      error?: string
    }>('/api/tts/voices'),
  trendsConfig: () => req<{ host: string; path: string; hasKey: boolean }>('/api/trends/config'),
  saveTrendsConfig: (host: string, path: string) => post<{ ok: boolean }>('/api/trends/config', { host, path }),
  testTrends: () => post<{ tags: string[]; count: number }>('/api/trends/test'),
  rapidApiStatus: () => req<{ has: boolean }>('/api/settings/rapidapi'),
  setRapidApiKey: (key: string) => post('/api/settings/rapidapi', { key }),
  cookiesStatus: () => req<{ has: boolean }>('/api/settings/cookies'),
  uploadCookies: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ ok: boolean }>('/api/settings/cookies', { method: 'POST', body: fd })
  },
  deleteCookies: () => req<{ ok: boolean }>('/api/settings/cookies', { method: 'DELETE' }),
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
    req<{ enabled: boolean; cron: string; nextRunAt: number | null; intervalSec: number | null; lastRunAt: number | null }>(
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
  /** Appelé à chaque (re)connexion du flux — utile pour purger les états périmés après un redémarrage serveur. */
  onOpen?: () => void
}): () => void {
  const es = new EventSource('/api/events')
  es.onopen = () => handlers.onOpen?.()
  es.addEventListener('progress', (ev) => handlers.onProgress?.(JSON.parse((ev as MessageEvent).data)))
  es.addEventListener('log', (ev) => handlers.onLog?.(JSON.parse((ev as MessageEvent).data).message))
  es.addEventListener('ideavideo', (ev) => handlers.onIdeaVideo?.(JSON.parse((ev as MessageEvent).data)))
  return () => es.close()
}

export function clipUrl(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return `/media/clips/${encodeURIComponent(base)}`
}
