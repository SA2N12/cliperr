// Types partagés entre le main process et le renderer (via IPC).
// Garder ce fichier sans dépendance Node/Electron : il est importé des deux côtés.

export type JobStage =
  | 'ingest'
  | 'transcribe'
  | 'highlights'
  | 'extract'
  | 'reframe'
  | 'captions'
  | 'metadata'
  | 'publish'

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

export interface SourceDTO {
  id: number
  url: string
  title: string | null
  author: string | null
  durationSec: number | null
  filePath: string | null
  status: JobStatus
  error: string | null
  createdAt: number
}

export interface ClipDTO {
  id: number
  sourceId: number
  startSec: number
  endSec: number
  score: number | null
  reason: string | null
  filePath: string | null
  title: string | null
  description: string | null
  hashtags: string | null
  reviewStatus: 'pending' | 'approved' | 'rejected'
  publishStatus: 'unpublished' | 'scheduled' | 'published' | 'failed'
  /** Compte/profil sur lequel le clip a été publié (upload-post, TikTok…). */
  publishedAccount: string | null
  /** Profil actif au moment de la création du clip (pour filtrer par profil). */
  profile: string | null
  /** URL + ID du post publié (pour les analytics par vidéo). */
  postUrl: string | null
  postId: string | null
  createdAt: number
}

export interface ViralIdea {
  title: string
  hook: string
  angle: string
  script: string[]
  format: string
  hashtags: string[]
  /** Style visuel imposé aux images de la vidéo (ex. repris d'une vidéo source en mode inspiration). */
  imageStyle?: string
}

export interface SavedIdea extends ViralIdea {
  id: number
  niche: string
  createdAt: number
}

export interface JobDTO {
  id: number
  sourceId: number | null
  clipId: number | null
  stage: JobStage
  status: JobStatus
  progress: number
  error: string | null
  updatedAt: number
}

/** Progression poussée du main vers le renderer pendant le pipeline. */
export interface ProgressEvent {
  sourceId: number
  stage: JobStage
  status: JobStatus
  progress: number // 0..1
  message?: string
}

/** Surface IPC exposée au renderer via contextBridge (window.api). */
export interface RendererApi {
  ping: () => Promise<string>
  getVersions: () => Promise<{ node: string; electron: string; chrome: string }>
  addSource: (url: string) => Promise<SourceDTO>
  listSources: () => Promise<SourceDTO[]>
  listClips: (sourceId?: number) => Promise<ClipDTO[]>
  runPipeline: (sourceId: number) => Promise<void>
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
}
