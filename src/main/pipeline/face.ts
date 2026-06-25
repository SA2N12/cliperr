import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { PipelineContext } from './context'

// La détection de visage tourne dans un PROCESS ENFANT (scripts/face-detect.cjs).
// OpenCV.js bloque le thread principal d'Electron ; en l'isolant, l'UI reste
// fluide et on peut tuer le process s'il dépasse le budget → recadrage centré.

const BUDGET_MS = 20000

function scriptPath(): string {
  const candidates = [
    join(process.cwd(), 'scripts', 'face-detect.cjs'),
    join(__dirname, '..', '..', 'scripts', 'face-detect.cjs')
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

/**
 * Renvoie la position horizontale normalisée (0..1) du visage dominant sur le
 * segment, ou null (aucun visage / délai dépassé / erreur). Ne bloque jamais le
 * thread principal : tout le travail OpenCV est délégué au process enfant.
 */
export function detectFaceCenterX(
  ctx: PipelineContext,
  source: string,
  start: number,
  end: number,
  cascadePath: string
): Promise<number | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ ffmpeg: ctx.bin.ffmpeg, source, start, end, cascade: cascadePath })
    const child = spawn(process.execPath, [scriptPath(), payload], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    let out = ''
    let done = false
    const finish = (v: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* déjà terminé */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), BUDGET_MS)
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', () => {
      /* drainé */
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      try {
        const j = JSON.parse(out.trim() || '{}')
        finish(typeof j.centerX === 'number' ? j.centerX : null)
      } catch {
        finish(null)
      }
    })
  })
}
