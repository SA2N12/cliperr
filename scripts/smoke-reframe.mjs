// Valide reframe 9:16 + incrustation .ass (commandes de reframe.ts/captions.ts), sans réseau.
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ffmpeg = ffmpegStatic
const ffprobe = ffprobeStatic.path
const dir = join(process.cwd(), '.tmp-bin')
await mkdir(dir, { recursive: true })

function rec(label, r) {
  if (r.status !== 0) {
    console.error(`${label} ÉCHEC (code ${r.status})\n${r.stderr}`)
    process.exit(1)
  }
  return r.stdout
}

// Vidéo source 16:9
rec('gen', spawnSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac',
  '-shortest', 'src.mp4'
], { cwd: dir, encoding: 'utf8' }))

// .ass au même format que captions.buildAss
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,115,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\fad(60,60)}BONJOUR
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\fad(60,60)}TIKTOK
`
await writeFile(join(dir, 'clip.ass'), ass, 'utf8')

// Rendu vertical (mêmes args que reframe.renderVerticalClip), cwd = dossier clips
rec('render', spawnSync(ffmpeg, [
  '-y', '-ss', '1.000', '-i', 'src.mp4', '-t', '3.000',
  '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles=clip.ass',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac',
  '-movflags', '+faststart', 'out.mp4'
], { cwd: dir, encoding: 'utf8' }))

const probe = rec('probe', spawnSync(ffprobe, [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
  '-of', 'json', join(dir, 'out.mp4')
], { encoding: 'utf8' }))
const j = JSON.parse(probe)
const { width, height } = j.streams[0]
const dur = parseFloat(j.format.duration)
console.log(`Sortie: ${width}x${height}, durée ${dur.toFixed(2)}s`)
if (width !== 1080 || height !== 1920) { console.error('Dimensions inattendues'); process.exit(1) }
if (dur < 2.7 || dur > 3.3) { console.error('Durée inattendue'); process.exit(1) }
console.log('\nOK — reframe 9:16 + sous-titres incrustés validés.')
