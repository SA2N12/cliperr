import { join } from 'path'
import { mkdir } from 'fs/promises'
import { run, type PipelineContext } from './context'

export interface RenderOptions {
  sourceFile: string // chemin absolu de la vidéo source
  start: number
  end: number
  outBasename: string // ex: "3-0.mp4" (dans le dossier clips)
  assBasename?: string // ex: "3-0.ass" (dans le dossier clips) — sous-titres optionnels
  width?: number
  height?: number
  focusX?: number // 0..1 : position horizontale du recadrage (0.5 = centré)
}

/**
 * Produit un clip vertical 9:16 : mise à l'échelle pour couvrir, recadrage
 * centré, puis (optionnel) incrustation des sous-titres — en une seule passe
 * ffmpeg. Le recadrage centré sera remplacé par un suivi de visage en Phase 6.
 *
 * On exécute avec cwd = dossier clips pour que le filtre `subtitles` trouve le
 * .ass par simple nom de fichier (évite l'enfer d'échappement des chemins
 * Windows dans le filtre subtitles).
 */
export async function renderVerticalClip(
  ctx: PipelineContext,
  opts: RenderOptions
): Promise<string> {
  await mkdir(ctx.dirs.clips, { recursive: true })
  const w = opts.width ?? 1080
  const h = opts.height ?? 1920
  const duration = Math.max(0.1, opts.end - opts.start)

  const ff = Math.min(1, Math.max(0, opts.focusX ?? 0.5))
  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    // x = (largeur_après_scale - w) * focusX → 0.5 = centré, fail-soft borné
    `crop=${w}:${h}:(in_w-${w})*${ff.toFixed(4)}:0`
  ]
  if (opts.assBasename) filters.push(`subtitles=${opts.assBasename}`)

  await run(
    ctx.bin.ffmpeg,
    [
      '-y',
      '-ss',
      opts.start.toFixed(3),
      '-i',
      opts.sourceFile,
      '-t',
      duration.toFixed(3),
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      opts.outBasename
    ],
    { cwd: ctx.dirs.clips }
  )

  return join(ctx.dirs.clips, opts.outBasename)
}
