import { exportClip } from './exportFolder'
import { publishVideo, uploadToInbox } from './tiktok'
import type { ClipDTO } from '../../shared/types'

export type PublishMode = 'export' | 'tiktok' | 'tiktok_draft'

export interface PublishDeps {
  mode: PublishMode
  exportDir: string
  getTikTokAccess: () => Promise<string | null>
  privacyLevel?: string
}

export interface PublishOutcome {
  ok: boolean
  detail: string
  /** Légende à finaliser (mode brouillon) — l'UI la copie/affiche. */
  caption?: string
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
