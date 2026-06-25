// Smoke-test jetable : valide ffmpeg/ffprobe bundlés + téléchargement/exécution de yt-dlp.
// Lancé en Node pur (hors Electron) — ne touche pas à better-sqlite3.
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, access, chmod } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function head(label, out) {
  console.log(`\n=== ${label} ===`)
  console.log((out || '').split('\n').slice(0, 2).join('\n'))
}

const ffmpeg = ffmpegStatic
const ffprobe = ffprobeStatic.path
console.log('ffmpeg :', ffmpeg)
console.log('ffprobe:', ffprobe)
head('ffmpeg -version', spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).stdout)
head('ffprobe -version', spawnSync(ffprobe, ['-version'], { encoding: 'utf8' }).stdout)

const binDir = join(process.cwd(), '.tmp-bin')
await mkdir(binDir, { recursive: true })
const name = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
const dest = join(binDir, name)

async function exists(p) { try { await access(p); return true } catch { return false } }

if (!(await exists(dest))) {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`
  console.log('\nTéléchargement yt-dlp depuis', url)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest)
    Readable.fromWeb(res.body).pipe(out).on('finish', resolve).on('error', reject)
  })
  if (process.platform !== 'win32') await chmod(dest, 0o755)
}
head('yt-dlp --version', spawnSync(dest, ['--version'], { encoding: 'utf8' }).stdout)
console.log('\nOK — plomberie des binaires validée.')
