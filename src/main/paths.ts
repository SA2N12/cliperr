import { app } from 'electron'
import { join } from 'path'

export interface AppPaths {
  data: string
  downloads: string
  clips: string
  bin: string
  models: string
}

/** Dossiers de travail, ancrés dans le userData d'Electron. */
export function appPaths(): AppPaths {
  const root = app.getPath('userData')
  return {
    data: root,
    downloads: join(root, 'downloads'),
    clips: join(root, 'clips'),
    bin: join(root, 'bin'),
    models: join(root, 'models')
  }
}
