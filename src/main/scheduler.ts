import cron, { type ScheduledTask } from 'node-cron'
import { BrowserWindow } from 'electron'
import * as repo from './db/repo'
import { publishClipById } from './publish/service'
import type { AppPaths } from './paths'

const FLAG_ENABLED = 'schedule_enabled'
const FLAG_CRON = 'schedule_cron'

let task: ScheduledTask | null = null
let appPathsRef: AppPaths | null = null

function broadcast(msg: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('publish:log', msg)
  }
}

async function tick(): Promise<void> {
  if (!appPathsRef) return
  const clip = repo.nextApprovedUnpublished()
  if (!clip) {
    broadcast('Planification : aucun clip validé en attente.')
    return
  }
  repo.setSetting('schedule_last_run', String(Date.now()))
  try {
    await publishClipById(clip.id, appPathsRef, broadcast)
  } catch {
    /* statut déjà mis à "failed" + journalisé */
  }
}

/** (Re)configure la tâche planifiée à partir des réglages. */
export function reloadScheduler(paths: AppPaths): void {
  appPathsRef = paths
  if (task) {
    task.stop()
    task = null
  }
  if (repo.getSetting(FLAG_ENABLED) !== '1') {
    broadcast('Planification désactivée.')
    return
  }
  const expr = repo.getSetting(FLAG_CRON) || '*/30 * * * *'
  if (!cron.validate(expr)) {
    broadcast(`Planification : expression cron invalide « ${expr} ».`)
    return
  }
  task = cron.schedule(expr, () => {
    void tick()
  })
  broadcast(`Planification activée (cron « ${expr} »).`)
}

export function startScheduler(paths: AppPaths): void {
  reloadScheduler(paths)
}
