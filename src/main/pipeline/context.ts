import { spawn } from 'child_process'
import type { Binaries } from '../binaries/manager'
import type { ProgressEvent } from '../../shared/types'

export interface PipelineDirs {
  downloads: string
  clips: string
  bin: string
}

export interface PipelineContext {
  bin: Binaries
  dirs: PipelineDirs
}

export interface RunOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  cwd?: string
}

// Processus enfants actifs (yt-dlp, ffmpeg…). Permet d'ANNULER une génération :
// tuer ces processus fait échouer l'étape en cours (téléchargement/montage), ce
// qui propage l'annulation jusqu'au pipeline (source marquée en erreur).
const activeChildren = new Set<ReturnType<typeof spawn>>()

/** Tue tous les processus enfants en cours. Renvoie combien ont été tués. */
export function killActiveChildren(): number {
  let n = 0
  for (const child of activeChildren) {
    try {
      child.kill('SIGKILL')
      n++
    } catch {
      /* déjà terminé */
    }
  }
  activeChildren.clear()
  return n
}

/** Lance un binaire et résout quand il se termine (rejette si code != 0). */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true })
    activeChildren.add(child)
    let stderrTail = ''
    child.stdout.on('data', (d: Buffer) => opts.onStdout?.(d.toString()))
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderrTail = (stderrTail + s).slice(-2000)
      opts.onStderr?.(s)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      activeChildren.delete(child)
      if (code === 0) resolve()
      else reject(new Error(`${bin} a terminé avec le code ${code}\n${stderrTail}`))
    })
  })
}

/** Lance un binaire et renvoie son stdout complet (pour parser du JSON). */
export function runCapture(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true })
    activeChildren.add(child)
    let stdout = ''
    let stderrTail = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      activeChildren.delete(child)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} a terminé avec le code ${code}\n${stderrTail}`))
    })
  })
}

export type Emit = (e: ProgressEvent) => void
