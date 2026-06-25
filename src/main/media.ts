import { protocol, net } from 'electron'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import type { AppPaths } from './paths'

export const MEDIA_SCHEME = 'clipmedia'

/** À appeler AVANT app.whenReady (sinon le scheme n'est pas privilégié). */
export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Sert les fichiers des dossiers clips/downloads au renderer via
 * `clipmedia://clips/<fichier>`. On ne sert que le basename dans un dossier
 * autorisé : aucune traversée de chemin possible.
 */
export function registerMediaProtocol(paths: AppPaths): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      const dir = url.hostname === 'downloads' ? paths.downloads : paths.clips
      const file = basename(decodeURIComponent(url.pathname))
      return net.fetch(pathToFileURL(join(dir, file)).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
