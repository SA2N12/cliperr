import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { run, type PipelineContext } from './context'

export interface Word {
  start: number // secondes
  end: number
  text: string
}

export interface WhisperBins {
  exe: string
  model: string
}

/** Extrait l'audio en WAV 16 kHz mono (format attendu par whisper.cpp). */
async function extractAudio(ctx: PipelineContext, source: string, wav: string): Promise<void> {
  await run(ctx.bin.ffmpeg, [
    '-y',
    '-i',
    source,
    '-vn',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    wav
  ])
}

interface WhisperJson {
  transcription?: Array<{
    offsets?: { from?: number; to?: number }
    text?: string
  }>
}

/**
 * Transcrit la vidéo source en mots horodatés via whisper.cpp.
 * Écrit aussi le transcript JSON à côté pour réutilisation.
 */
export async function transcribeSource(
  ctx: PipelineContext,
  whisper: WhisperBins,
  source: string,
  sourceId: number
): Promise<Word[]> {
  const wav = join(ctx.dirs.downloads, `${sourceId}.wav`)
  const outBase = join(ctx.dirs.downloads, `${sourceId}.whisper`)
  await extractAudio(ctx, source, wav)

  // -oj: JSON ; -ml 1 + -sow: ~un mot par segment ; -l auto: langue auto.
  await run(whisper.exe, [
    '-m',
    whisper.model,
    '-f',
    wav,
    '-oj',
    '-of',
    outBase,
    '-ml',
    '1',
    '-sow',
    '-l',
    'auto'
  ])

  const raw = await readFile(`${outBase}.json`, 'utf8')
  const parsed = JSON.parse(raw) as WhisperJson
  const words: Word[] = (parsed.transcription ?? [])
    .map((seg) => ({
      start: (seg.offsets?.from ?? 0) / 1000,
      end: (seg.offsets?.to ?? 0) / 1000,
      text: (seg.text ?? '').trim()
    }))
    .filter((w) => w.text.length > 0)

  await writeFile(
    join(ctx.dirs.clips, `${sourceId}.transcript.json`),
    JSON.stringify(words),
    'utf8'
  )
  return words
}

/**
 * Transcription via l'API Groq (Whisper large v3 turbo sur GPU) — beaucoup plus
 * rapide que le local. Envoie l'audio compressé et récupère les mots horodatés.
 */
export async function transcribeWithGroq(
  ctx: PipelineContext,
  apiKey: string,
  source: string,
  sourceId: number
): Promise<Word[]> {
  // 32 kbps mono : ~14 Mo pour 1h (sous la limite Groq de 25 Mo) ; suffisant pour la parole.
  const mp3 = join(ctx.dirs.downloads, `${sourceId}.mp3`)
  await run(ctx.bin.ffmpeg, [
    '-y',
    '-i',
    source,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '32k',
    mp3
  ])

  const buf = await readFile(mp3)
  const form = new FormData()
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!res.ok) throw new Error(`Groq ${res.status} : ${(await res.text()).slice(0, 300)}`)

  const j = (await res.json()) as {
    words?: Array<{ word: string; start: number; end: number }>
  }
  const words: Word[] = (j.words ?? [])
    .map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0)

  await writeFile(
    join(ctx.dirs.clips, `${sourceId}.transcript.json`),
    JSON.stringify(words),
    'utf8'
  )
  return words
}
