import { join } from 'path'
import { mkdir } from 'fs/promises'
import { run, runCapture, type PipelineContext } from './context'

export interface Segment {
  start: number
  end: number
}

/** Durée de la vidéo en secondes (ffprobe). */
export async function probeDuration(ctx: PipelineContext, file: string): Promise<number> {
  const out = await runCapture(ctx.bin.ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file
  ])
  const parsed = JSON.parse(out) as { format?: { duration?: string } }
  return parsed.format?.duration ? parseFloat(parsed.format.duration) : 0
}

/**
 * Découpe un segment du fichier source en MP4 ré-encodé (coupe précise).
 * On ré-encode plutôt que `-c copy` pour des coupures exactes et un fichier
 * directement exploitable pour le reframe / les sous-titres en aval.
 */
export async function cutClip(
  ctx: PipelineContext,
  sourceFile: string,
  seg: Segment,
  outFile: string
): Promise<string> {
  await mkdir(ctx.dirs.clips, { recursive: true })
  const duration = Math.max(0.1, seg.end - seg.start)
  await run(ctx.bin.ffmpeg, [
    '-y',
    '-ss',
    seg.start.toFixed(3),
    '-i',
    sourceFile,
    '-t',
    duration.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outFile
  ])
  return outFile
}

export function clipOutputPath(ctx: PipelineContext, sourceId: number, index: number): string {
  return join(ctx.dirs.clips, `${sourceId}-${index}.mp4`)
}

/**
 * Segments "naïfs" pour le MVP (Phase 1) : quelques fenêtres réparties sur la
 * durée. Remplacé en Phase 2 par la sélection IA des moments forts.
 */
export function naiveSegments(durationSec: number, count = 3, windowSec = 30): Segment[] {
  if (durationSec <= windowSec) return [{ start: 0, end: Math.max(1, durationSec) }]
  const n = Math.max(1, count)
  const segments: Segment[] = []
  for (let i = 0; i < n; i++) {
    // Positions réparties régulièrement sur [0.05, 0.9] de la durée.
    const p = n === 1 ? 0.1 : 0.05 + (0.85 * i) / (n - 1)
    const start = Math.min(durationSec - windowSec, Math.max(0, durationSec * p))
    segments.push({ start, end: start + windowSec })
  }
  return segments
}
