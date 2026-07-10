import { createWriteStream } from 'fs'
import { chmod, mkdir, access, readdir, rm } from 'fs/promises'
import { Readable } from 'node:stream'
import { join } from 'path'
import extract from 'extract-zip'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

export interface Binaries {
  ffmpeg: string
  ffprobe: string
  ytDlp: string
}

/**
 * En production, les binaires bundlés vivent dans `app.asar` qui n'est pas
 * exécutable. electron-builder les "déballe" dans `app.asar.unpacked` (cf.
 * asarUnpack dans la config). On corrige le chemin ici ; no-op en dev.
 */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

export function bundledFfmpeg(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg-static introuvable')
  return unpacked(ffmpegStatic)
}

export function bundledFfprobe(): string {
  return unpacked(ffprobeStatic.path)
}

export function ytDlpFilename(): string {
  switch (process.platform) {
    case 'win32':
      return 'yt-dlp.exe'
    case 'darwin':
      return 'yt-dlp_macos'
    default:
      return 'yt-dlp_linux'
  }
}

function ytDlpUrl(): string {
  // Nightly : YouTube casse yt-dlp très régulièrement, la version stable est
  // souvent trop datée (« No video formats found »). On aligne sur updateYtDlp.
  return `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${ytDlpFilename()}`
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Téléchargement échoué (${res.status}) : ${url}`)
  }
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest)
    Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0])
      .pipe(out)
      .on('finish', () => resolve())
      .on('error', reject)
  })
}

/**
 * Installe le plugin bgutil PO token de yt-dlp dans binDir/yt-dlp-plugins.
 * Couplé au conteneur Docker du provider, il réactive le téléchargement YouTube.
 */
export async function installPotPlugin(
  binDir: string,
  onLog?: (msg: string) => void
): Promise<string> {
  const pluginsDir = join(binDir, 'yt-dlp-plugins')
  // yt-dlp exige la structure `yt-dlp-plugins/<paquet>/yt_dlp_plugins/…`. Le zip
  // contient `yt_dlp_plugins/` à sa racine : on l'extrait donc dans un sous-dossier
  // « bgutil » pour obtenir le niveau « paquet » attendu. On repart propre pour
  // corriger une éventuelle ancienne extraction (sans ce niveau).
  await rm(pluginsDir, { recursive: true, force: true })
  const pkgDir = join(pluginsDir, 'bgutil')
  await mkdir(pkgDir, { recursive: true })
  const zip = join(binDir, 'bgutil-pot.zip')
  const url =
    'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip'
  onLog?.('Téléchargement du plugin PO token…')
  await download(url, zip)
  await extract(zip, { dir: pkgDir })
  await rm(zip, { force: true })
  onLog?.('Plugin PO token installé ✅ — lance le conteneur Docker puis relance le pipeline.')
  return pluginsDir
}

/** Met à jour yt-dlp vers la dernière build nightly (corrige les cassures YouTube). */
export async function updateYtDlp(
  binDir: string,
  onLog?: (msg: string) => void
): Promise<string> {
  await mkdir(binDir, { recursive: true })
  const dest = join(binDir, ytDlpFilename())
  const url = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${ytDlpFilename()}`
  onLog?.('Mise à jour de yt-dlp (dernière version)…')
  await download(url, dest)
  if (process.platform !== 'win32') await chmod(dest, 0o755)
  onLog?.('yt-dlp mis à jour ✅ — relance le pipeline.')
  return dest
}

/** Télécharge yt-dlp dans binDir s'il est absent, et renvoie son chemin. */
export async function ensureYtDlp(
  binDir: string,
  onLog?: (msg: string) => void
): Promise<string> {
  await mkdir(binDir, { recursive: true })
  const dest = join(binDir, ytDlpFilename())
  if (await exists(dest)) return dest
  onLog?.('Téléchargement de yt-dlp…')
  await download(ytDlpUrl(), dest)
  if (process.platform !== 'win32') await chmod(dest, 0o755)
  onLog?.('yt-dlp installé.')
  return dest
}

export function denoFilename(): string {
  return process.platform === 'win32' ? 'deno.exe' : 'deno'
}

function denoAsset(): string {
  const arm = process.arch === 'arm64'
  switch (process.platform) {
    case 'win32':
      return 'deno-x86_64-pc-windows-msvc.zip'
    case 'darwin':
      return arm ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip'
    default:
      return arm ? 'deno-aarch64-unknown-linux-gnu.zip' : 'deno-x86_64-unknown-linux-gnu.zip'
  }
}

/**
 * Télécharge Deno dans binDir s'il est absent. yt-dlp s'en sert comme runtime JS
 * pour résoudre les défis de signature YouTube (« nsig ») : sans lui, YouTube ne
 * renvoie que des images (« Only images are available for download »). binDir est
 * ajouté au PATH au démarrage du serveur, donc yt-dlp le trouve automatiquement.
 */
export async function ensureDeno(binDir: string, onLog?: (msg: string) => void): Promise<string> {
  await mkdir(binDir, { recursive: true })
  const dest = join(binDir, denoFilename())
  if (await exists(dest)) return dest
  onLog?.('Téléchargement de Deno (runtime JS pour yt-dlp)…')
  const zip = join(binDir, 'deno.zip')
  await download(`https://github.com/denoland/deno/releases/latest/download/${denoAsset()}`, zip)
  await extract(zip, { dir: binDir })
  await rm(zip, { force: true })
  if (process.platform !== 'win32') await chmod(dest, 0o755)
  onLog?.('Deno installé.')
  return dest
}

/** Résout l'ensemble des binaires nécessaires au pipeline. */
export async function resolveBinaries(
  binDir: string,
  onLog?: (msg: string) => void
): Promise<Binaries> {
  const ytDlp = await ensureYtDlp(binDir, onLog)
  // Best-effort : ne bloque pas tout le pipeline si Deno ne s'installe pas
  // (ex. hors-ligne). Le téléchargement YouTube échouera alors proprement.
  await ensureDeno(binDir, onLog).catch((e) =>
    onLog?.(`Deno non installé (${e instanceof Error ? e.message : e}) — le téléchargement YouTube risque d'échouer.`)
  )
  return {
    ffmpeg: bundledFfmpeg(),
    ffprobe: bundledFfprobe(),
    ytDlp
  }
}

// ─────────────────────────── Whisper (transcription) ───────────────────────────

export interface WhisperBins {
  exe: string
  model: string
}

const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'

const CASCADE_URL =
  'https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_default.xml'

/** Télécharge le cascade Haar de détection de visage si absent. */
export async function ensureFaceCascade(
  modelDir: string,
  onLog?: (msg: string) => void
): Promise<string> {
  await mkdir(modelDir, { recursive: true })
  const dest = join(modelDir, 'haarcascade_frontalface_default.xml')
  if (await exists(dest)) return dest
  onLog?.('Téléchargement du modèle de détection de visage…')
  await download(CASCADE_URL, dest)
  return dest
}

/** Télécharge le modèle ggml si absent (~148 Mo). */
export async function ensureWhisperModel(
  modelDir: string,
  onLog?: (msg: string) => void
): Promise<string> {
  await mkdir(modelDir, { recursive: true })
  const dest = join(modelDir, 'ggml-base.bin')
  if (await exists(dest)) return dest
  onLog?.('Téléchargement du modèle Whisper (~148 Mo)…')
  await download(WHISPER_MODEL_URL, dest)
  onLog?.('Modèle Whisper installé.')
  return dest
}

async function findExe(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { recursive: true })
  const candidates = ['whisper-cli.exe', 'main.exe', 'whisper-cli', 'main']
  for (const name of candidates) {
    const hit = entries.find((e) => e.replace(/\\/g, '/').endsWith('/' + name) || e === name)
    if (hit) return join(dir, hit)
  }
  return null
}

/**
 * Télécharge et installe le binaire whisper.cpp (Windows uniquement pour
 * l'instant) puis le modèle. Renvoie les chemins. Lève sur plateforme non
 * supportée — l'appelant traite l'échec en mode fail-soft.
 */
export async function ensureWhisper(
  binDir: string,
  modelDir: string,
  onLog?: (msg: string) => void
): Promise<WhisperBins> {
  if (process.platform !== 'win32') {
    throw new Error('Téléchargement automatique de whisper.cpp non supporté sur cette plateforme')
  }
  const whisperDir = join(binDir, 'whisper')
  await mkdir(whisperDir, { recursive: true })

  let exe = await findExe(whisperDir)
  if (!exe) {
    onLog?.('Récupération de whisper.cpp…')
    const rel = await fetch('https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest', {
      headers: { 'User-Agent': 'tiktokclip', Accept: 'application/vnd.github+json' }
    })
    if (!rel.ok) throw new Error(`GitHub API ${rel.status}`)
    const json = (await rel.json()) as { assets?: Array<{ name: string; browser_download_url: string }> }
    const asset = (json.assets ?? []).find((a) => /whisper-bin-x64\.zip$/i.test(a.name))
    if (!asset) throw new Error('Binaire whisper.cpp Windows introuvable dans la release')
    const zip = join(whisperDir, 'whisper.zip')
    onLog?.('Téléchargement de whisper.cpp…')
    await download(asset.browser_download_url, zip)
    await extract(zip, { dir: whisperDir })
    await rm(zip, { force: true })
    exe = await findExe(whisperDir)
  }
  if (!exe) throw new Error('Exécutable whisper introuvable après extraction')

  const model = await ensureWhisperModel(modelDir, onLog)
  onLog?.('Whisper prêt.')
  return { exe, model }
}
