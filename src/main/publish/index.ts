import { exportClip } from './exportFolder'
import { publishVideo, uploadToInbox } from './tiktok'
import { uploadPostTikTok } from './uploadpost'
import type { ClipDTO } from '../../shared/types'

export type PublishMode = 'export' | 'tiktok' | 'tiktok_draft' | 'uploadpost'

export interface PublishDeps {
  mode: PublishMode
  exportDir: string
  getTikTokAccess: () => Promise<string | null>
  privacyLevel?: string
  uploadPostKey?: string | null
  uploadPostUser?: string | null
  /** Journal (diagnostic des réponses ambiguës d'upload-post). */
  onNote?: (m: string) => void
}

export interface PublishOutcome {
  ok: boolean
  detail: string
  /** Légende à finaliser (mode brouillon) — l'UI la copie/affiche. */
  caption?: string
  /** URL + ID du post publié (upload-post) pour les analytics par vidéo. */
  postUrl?: string | null
  postId?: string | null
}

/** Choix confirmés par l'utilisateur sur l'écran de prévisualisation. */
export interface PublishOverrides {
  caption?: string
  privacyLevel?: string
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  brandOrganic?: boolean
  brandContent?: boolean
  /** upload-post : force un compte précis (sinon rotation auto). */
  uploadPostUser?: string
  /** Type de la vidéo (niche/serie/custom/clip) → choisit le bon CTA du compte. */
  videoType?: string
}

function captionOf(clip: ClipDTO): string {
  return [clip.description, clip.hashtags].filter(Boolean).join(' ') || clip.title || ''
}

export async function publishClip(
  clip: ClipDTO,
  deps: PublishDeps,
  overrides: PublishOverrides = {}
): Promise<PublishOutcome> {
  if (!clip.filePath) throw new Error('Clip sans fichier')
  const caption = overrides.caption ?? captionOf(clip)

  if (deps.mode === 'uploadpost') {
    const res = await uploadPostTikTok({
      apiKey: deps.uploadPostKey ?? '',
      user: deps.uploadPostUser ?? '',
      filePath: clip.filePath,
      caption,
      privacyLevel: overrides.privacyLevel ?? deps.privacyLevel,
      disableComment: overrides.disableComment,
      disableDuet: overrides.disableDuet,
      disableStitch: overrides.disableStitch,
      onNote: deps.onNote
    })
    return { ok: true, detail: res.url ? `Publié via upload-post → ${res.url}` : 'Publié via upload-post', postUrl: res.url, postId: res.postId }
  }

  if (deps.mode === 'tiktok' || deps.mode === 'tiktok_draft') {
    const token = await deps.getTikTokAccess()
    if (!token) throw new Error('TikTok non connecté')

    if (deps.mode === 'tiktok_draft') {
      const res = await uploadToInbox({ accessToken: token, filePath: clip.filePath })
      return {
        ok: true,
        detail: `Brouillon TikTok envoyé (${res.publishId}) — finalise la légende dans l'app TikTok`,
        caption: caption || undefined
      }
    }

    const res = await publishVideo({
      accessToken: token,
      filePath: clip.filePath,
      caption,
      privacyLevel: overrides.privacyLevel ?? deps.privacyLevel,
      disableComment: overrides.disableComment,
      disableDuet: overrides.disableDuet,
      disableStitch: overrides.disableStitch,
      brandOrganic: overrides.brandOrganic,
      brandContent: overrides.brandContent
    })
    return { ok: true, detail: `TikTok ${res.status} (${res.publishId})` }
  }

  const dest = await exportClip(clip, deps.exportDir)
  return { ok: true, detail: `Exporté → ${dest}` }
}
