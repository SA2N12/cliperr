import { join, basename } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { run, runCapture, type PipelineContext } from './context'

/** Vrai si `s` désigne un fichier local existant (et non une URL http(s)). */
export function isLocalFile(s: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && existsSync(s)
}

export interface SourceMeta {
  title: string | null
  author: string | null
  durationSec: number | null
}

/**
 * Args cookies pour contourner l'anti-bot YouTube. Un fichier cookies.txt est
 * prioritaire (fiable, ne touche pas au navigateur) ; sinon lecture directe du
 * navigateur (peut échouer si celui-ci est ouvert sur Windows).
 */
function cookieArgs(browser?: string | null, file?: string | null): string[] {
  if (file) return ['--cookies', file]
  if (browser) return ['--cookies-from-browser', browser]
  return []
}

/**
 * Active le plugin PO token (bgutil) s'il est installé. On pointe `--plugin-dirs`
 * sur le dossier `yt-dlp-plugins` : yt-dlp y cherche les paquets `<pkg>/yt_dlp_plugins`
 * (cf. installPotPlugin qui extrait dans `yt-dlp-plugins/bgutil/yt_dlp_plugins`).
 *
 * Le provider bgutil tourne dans un conteneur séparé (variable `BGUTIL_URL`,
 * ex. http://bgutil-provider:4416). Sans lui indiquer cette URL, le plugin HTTP
 * chercherait le provider sur 127.0.0.1:4416 (absent dans notre conteneur) et
 * n'obtiendrait aucun PO token.
 */
function pluginArgs(binDir: string): string[] {
  const base = join(binDir, 'yt-dlp-plugins')
  if (!existsSync(base)) return []
  const args = ['--plugin-dirs', base]
  const potUrl = process.env.BGUTIL_URL
  if (potUrl) args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${potUrl}`)
  return args
}

/**
 * Proxy optionnel pour yt-dlp (variable `DOWNLOAD_PROXY`, ex. http://user:pass@ip:port).
 * Vide par défaut : on télécharge depuis l'IP du VPS. Utile si YouTube se met à
 * rate-limiter (HTTP 429) ou bloquer cette IP — on bascule alors sur un proxy
 * résidentiel/ISP sans toucher au code.
 */
function proxyArgs(): string[] {
  const p = process.env.DOWNLOAD_PROXY
  return p ? ['--proxy', p] : []
}

/** Diagnostic verbeux : formats + chargement des plugins + tentatives de PO token. */
function listFormats(
  ctx: PipelineContext,
  url: string,
  browser?: string | null,
  file?: string | null
): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      ctx.bin.ytDlp,
      ['-F', '-v', '--no-playlist', ...cookieArgs(browser, file), ...pluginArgs(ctx.dirs.bin), ...proxyArgs(), url],
      { windowsHide: true }
    )
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', (e) => resolve(String(e)))
    child.on('close', () => resolve(out))
  })
}

/** Ne garde que les lignes utiles du diagnostic (plugins, PO token, formats). */
function diag(raw: string): string {
  const lines = raw
    .split('\n')
    .filter((l) =>
      /plugin|po.?token|bgutil|getpot|not a bot|Available formats|^ERROR|player API|^\S+\s+(mp4|webm|m4a|mhtml)/i.test(
        l
      )
    )
  const text = lines.join('\n') || raw
  return text.length > 3000 ? text.slice(0, 3000) : text
}

/** Récupère les métadonnées sans télécharger la vidéo (yt-dlp -J). */
export async function fetchMetadata(
  ctx: PipelineContext,
  url: string,
  cookiesFromBrowser?: string | null,
  cookiesFile?: string | null
): Promise<SourceMeta> {
  // Fichier local importé : pas de yt-dlp, métadonnées minimales (durée probée plus tard).
  if (isLocalFile(url)) {
    return { title: basename(url), author: 'Fichier importé', durationSec: null }
  }
  let out: string
  try {
    out = await runCapture(ctx.bin.ytDlp, [
      '-J',
      '--no-warnings',
      '--no-playlist',
      ...cookieArgs(cookiesFromBrowser, cookiesFile),
      ...pluginArgs(ctx.dirs.bin),
      ...proxyArgs(),
      url
    ])
  } catch (e) {
    const fmts = await listFormats(ctx, url, cookiesFromBrowser, cookiesFile)
    throw new Error(
      `${e instanceof Error ? e.message : e}\n\n=== DIAGNOSTIC ===\n${diag(fmts)}`
    )
  }
  const info = JSON.parse(out) as {
    title?: string
    uploader?: string
    channel?: string
    duration?: number
  }
  return {
    title: info.title ?? null,
    author: info.uploader ?? info.channel ?? null,
    durationSec: typeof info.duration === 'number' ? info.duration : null
  }
}

/**
 * Télécharge la VOD source en MP4 (H.264/AAC fusionné via ffmpeg).
 * Renvoie le chemin du fichier produit.
 */
export async function downloadVideo(
  ctx: PipelineContext,
  url: string,
  sourceId: number,
  onProgress?: (ratio: number) => void,
  cookiesFromBrowser?: string | null,
  cookiesFile?: string | null
): Promise<string> {
  // Fichier local importé : on l'utilise tel quel, aucun téléchargement.
  if (isLocalFile(url)) {
    onProgress?.(1)
    return url
  }

  await mkdir(ctx.dirs.downloads, { recursive: true })
  const outBase = join(ctx.dirs.downloads, String(sourceId))
  const outTemplate = `${outBase}.%(ext)s`
  const expected = `${outBase}.mp4`

  try {
    await run(
      ctx.bin.ytDlp,
      [
        '--no-warnings',
        '--no-playlist',
        ...cookieArgs(cookiesFromBrowser, cookiesFile),
        ...pluginArgs(ctx.dirs.bin),
        ...proxyArgs(),
        '--ffmpeg-location',
        ctx.bin.ffmpeg,
        // Préfère ≤1080, mais retombe sur n'importe quel meilleur format dispo.
        '-f',
        'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
        '--merge-output-format',
        'mp4',
        '-o',
        outTemplate,
        url
      ],
      {
        onStdout: (chunk) => {
          // Lignes de type "[download]  42.3% of ~120.00MiB at 5.00MiB/s"
          const m = chunk.match(/\[download\]\s+([\d.]+)%/)
          if (m) onProgress?.(Math.min(1, parseFloat(m[1]) / 100))
        }
      }
    )
  } catch (e) {
    const fmts = await listFormats(ctx, url, cookiesFromBrowser, cookiesFile)
    throw new Error(
      `${e instanceof Error ? e.message : e}\n\n=== DIAGNOSTIC ===\n${diag(fmts)}`
    )
  }

  return expected
}
