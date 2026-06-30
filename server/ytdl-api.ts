import { join } from 'path'
import { mkdir, rm } from 'fs/promises'
import { createWriteStream } from 'fs'
import { Readable, PassThrough } from 'stream'
import { pipeline } from 'stream/promises'
import { run, type PipelineContext } from '../src/main/pipeline/context'

// Téléchargement de VOD YouTube via l'API RapidAPI « YouTube Media Downloader »
// (DataFanatic). But : contourner le blocage anti-bot de YouTube sur l'IP du VPS
// (datacenter), là où yt-dlp échoue. L'API renvoie des URLs googlevideo directes
// que ffmpeg sait lire ; on prend la meilleure vidéo MP4 ≤1080 + une piste audio
// m4a et on les fusionne (copie sans réencodage) en un MP4 local.

const HOST = 'youtube-media-downloader.p.rapidapi.com'

export interface SourceMetaApi {
  title: string | null
  author: string | null
  durationSec: number | null
}

interface VideoItem {
  url: string
  extension: string
  hasAudio: boolean
  width: number
  height: number
  quality?: string
}
interface AudioItem {
  url: string
  extension: string
}
interface VideoDetails {
  errorId?: string
  title?: string
  channel?: { name?: string }
  lengthSeconds?: number
  videos?: { items?: VideoItem[] }
  audios?: { items?: AudioItem[] }
}

/** Extrait l'ID d'une vidéo depuis une URL YouTube (watch, youtu.be, shorts, embed…). */
export function extractVideoId(input: string): string | null {
  try {
    const u = new URL(input)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = u.pathname.match(/^\/(shorts|embed|v|live)\/([^/?]+)/)
      if (m) return m[2]
      return u.searchParams.get('v')
    }
    return null
  } catch {
    return null
  }
}

/** Vrai si l'URL est une vidéo YouTube reconnue (donc éligible au téléchargement API). */
export function isYouTubeUrl(input: string): boolean {
  return extractVideoId(input) != null
}

/**
 * Télécharge une URL vers un fichier via Node `fetch` (TLS de Node, fiable).
 * On NE laisse PAS ffmpeg lire les URLs googlevideo directement : son build
 * statique Linux segfault (SIGSEGV) sur ces flux HTTPS. On télécharge donc
 * d'abord, puis ffmpeg ne touche que des fichiers locaux.
 */
async function dlToFile(url: string, dest: string, onProgress?: (ratio: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`téléchargement HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  const counter = new PassThrough()
  counter.on('data', (c: Buffer) => {
    received += c.length
    if (total > 0) onProgress?.(Math.min(1, received / total))
  })
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), counter, createWriteStream(dest))
}

/**
 * Télécharge une VOD YouTube via RapidAPI et la fusionne en MP4 local.
 * Renvoie le chemin du fichier produit et les métadonnées issues de l'API.
 */
export async function downloadViaApi(
  ctx: PipelineContext,
  apiKey: string,
  url: string,
  sourceId: number,
  onProgress?: (ratio: number) => void,
  log?: (m: string) => void
): Promise<{ filePath: string; meta: SourceMetaApi }> {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('URL YouTube non reconnue par l’API')

  log?.('Récupération des liens de téléchargement (RapidAPI)…')
  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(`https://${HOST}/v2/video/details?videoId=${encodeURIComponent(videoId)}`, {
      headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': apiKey }
    })
  } catch (e) {
    throw new Error(`RapidAPI injoignable : ${e instanceof Error ? e.message : e}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`RapidAPI a répondu ${res.status} : ${body.slice(0, 300)}`)
  }
  const d = (await res.json()) as VideoDetails
  if (d.errorId && d.errorId !== 'Success') {
    throw new Error(`RapidAPI : ${d.errorId}`)
  }

  const vitems = d.videos?.items ?? []
  const aitems = d.audios?.items ?? []

  // Meilleure vidéo MP4 ≤1080 (H.264, compatible recadrage/sous-titres ffmpeg).
  const mp4s = vitems
    .filter((v) => v.extension === 'mp4' && v.height <= 1080 && !!v.url)
    .sort((a, b) => b.height - a.height)
  if (!mp4s.length) throw new Error('Aucun format MP4 disponible via l’API')
  const video = mp4s[0]
  // Si la vidéo n'a pas d'audio intégré (cas des HD), on prend une piste m4a (AAC).
  const audio = video.hasAudio ? null : aitems.find((a) => a.extension === 'm4a') ?? aitems[0] ?? null
  if (!video.hasAudio && !audio) throw new Error('Aucune piste audio disponible via l’API')

  await mkdir(ctx.dirs.downloads, { recursive: true })
  const outPath = join(ctx.dirs.downloads, `${sourceId}.mp4`)
  const qLabel = video.quality ?? `${video.height}p`

  if (!audio) {
    // Format progressif (vidéo + audio déjà intégrés) : téléchargement direct.
    log?.(`Téléchargement ${qLabel}…`)
    await dlToFile(video.url, outPath, (r) => onProgress?.(r))
  } else {
    // HD = flux séparés : on télécharge vidéo puis audio, puis fusion locale.
    const vPath = join(ctx.dirs.downloads, `${sourceId}.video.mp4`)
    const aPath = join(ctx.dirs.downloads, `${sourceId}.audio.m4a`)
    try {
      log?.(`Téléchargement vidéo ${qLabel}…`)
      await dlToFile(video.url, vPath, (r) => onProgress?.(r * 0.85))
      log?.('Téléchargement audio…')
      await dlToFile(audio.url, aPath, (r) => onProgress?.(0.85 + r * 0.1))
      log?.('Fusion vidéo + audio…')
      await run(ctx.bin.ffmpeg, [
        '-y', '-loglevel', 'error',
        '-i', vPath, '-i', aPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c', 'copy', outPath
      ])
    } finally {
      await rm(vPath, { force: true })
      await rm(aPath, { force: true })
    }
  }
  onProgress?.(1)

  return {
    filePath: outPath,
    meta: {
      title: d.title ?? null,
      author: d.channel?.name ?? null,
      durationSec: typeof d.lengthSeconds === 'number' ? d.lengthSeconds : null
    }
  }
}
