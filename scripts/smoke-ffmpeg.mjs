// Valide les commandes ffmpeg/ffprobe de extract.ts sur une vidéo synthétique (sans réseau).
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ffmpeg = ffmpegStatic
const ffprobe = ffprobeStatic.path
const dir = join(process.cwd(), '.tmp-bin')
await mkdir(dir, { recursive: true })
const src = join(dir, 'testsrc.mp4')
const clip = join(dir, 'clip.mp4')

function rec(label, r) {
  if (r.status !== 0) {
    console.error(`${label} ÉCHEC (code ${r.status})\n${r.stderr}`)
    process.exit(1)
  }
  return r.stdout
}

// 1) Générer 5s de vidéo+audio synthétique
rec('generate', spawnSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac',
  '-movflags', '+faststart', '-shortest', src
], { encoding: 'utf8' }))

// 2) Probe durée (mêmes args que extract.probeDuration)
const probe = rec('probe', spawnSync(ffprobe, [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', src
], { encoding: 'utf8' }))
const dur = JSON.parse(probe).format.duration
console.log('Durée source (s):', dur)

// 3) Découper 1.000 → 3.000 (mêmes args que extract.cutClip)
rec('cut', spawnSync(ffmpeg, [
  '-y', '-ss', '1.000', '-i', src, '-t', '2.000',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac',
  '-movflags', '+faststart', clip
], { encoding: 'utf8' }))

const probe2 = rec('probe-clip', spawnSync(ffprobe, [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', clip
], { encoding: 'utf8' }))
const clipDur = parseFloat(JSON.parse(probe2).format.duration)
console.log('Durée clip (s):', clipDur, '(attendu ~2.0)')
if (clipDur < 1.7 || clipDur > 2.3) { console.error('Durée de clip inattendue'); process.exit(1) }
console.log('\nOK — étape extract (probe + cut) validée.')
