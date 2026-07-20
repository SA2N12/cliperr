import type { Request, Response } from 'express'
import * as repo from '../src/main/db/repo'

// Bus d'événements simple : le serveur pousse la progression du pipeline et les
// logs de publication vers les clients connectés via Server-Sent Events.

type Client = Response
const clients = new Set<Client>()

export function sseHandler(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  res.write(': connected\n\n')
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
}

function broadcastRaw(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) {
    try {
      c.write(payload)
    } catch {
      /* client parti */
    }
  }
}

/** Progression du pipeline (même forme que l'ancien ProgressEvent IPC). */
export function emitProgress(ev: unknown): void {
  broadcastRaw('progress', ev)
}

/**
 * Ligne de journal (publication, planification, etc.). Aussi en console (docker
 * logs) et **persistée en base** : la console du dashboard peut ainsi relire
 * tout l'historique, pas seulement les événements reçus depuis l'ouverture.
 */
export function emitLog(message: string): void {
  console.log(`[log] ${message}`)
  try {
    repo.addActivity(message)
  } catch {
    /* base pas encore prête (démarrage) : on ne bloque jamais un log */
  }
  broadcastRaw('log', { message })
}

/** Progression de la génération d'une vidéo depuis une idée. Aussi en console (docker logs). */
export function emitIdeaVideo(ev: { ideaId: number; status: 'running' | 'done' | 'error'; message: string }): void {
  console.log(`[video ${ev.ideaId}] ${ev.status} — ${ev.message}`)
  broadcastRaw('ideavideo', ev)
}
