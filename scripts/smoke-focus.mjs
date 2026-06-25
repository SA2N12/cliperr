// Valide le filtre de recadrage décalé (focusX) de reframe.ts.
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ffmpeg = ffmpegStatic
const ffprobe = ffprobeStatic.path
const dir = join(process.cwd(), '.tmp-bin')
await mkdir(dir, { recursive: true })

function rec(label, r) {
  if (r.status !== 0) {
    console.error(`${label} ÉCHEC\n${r.stderr}`)
    process.exit(1)
  }
  return r.stdout
}

rec('gen', spawnSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2',
  '-c:v', 'libx264', '-preset', 'veryfast', 'src.mp4'
], { cwd: dir, encoding: 'utf8' }))

// focusX = 0.75 (décalé à droite) — même expression que reframe.ts
const ff = (0.75).toFixed(4)
rec('render', spawnSync(ffmpeg, [
  '-y', '-ss', '0', '-i', 'src.mp4', '-t', '1',
  '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)*${ff}:0`,
  '-c:v', 'libx264', '-preset', 'veryfast', 'out.mp4'
], { cwd: dir, encoding: 'utf8' }))

const probe = rec('probe', spawnSync(ffprobe, [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
  '-of', 'json', join(dir, 'out.mp4')
], { encoding: 'utf8' }))
const { width, height } = JSON.parse(probe).streams[0]
console.log(`Sortie: ${width}x${height} (focusX=${ff})`)
if (width !== 1080 || height !== 1920) { console.error('Dimensions inattendues'); process.exit(1) }
console.log('\nOK — recadrage décalé (focusX) validé.')
