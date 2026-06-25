import { join } from 'path'
import type { PipelineContext, Emit } from './context'
import { fetchMetadata, downloadVideo, type SourceMeta } from './ingest'
import { probeDuration, naiveSegments } from './extract'
import { type Word } from './transcribe'
import { selectHighlights, type HighlightSegment, type Usage } from './highlights'
import { wordsInRange, buildAss, writeAss } from './captions'
import { renderVerticalClip } from './reframe'
import { generateMetadata } from './metadata'
import type { JobStage, JobStatus } from '../../shared/types'

export interface OrchestratorCallbacks {
  emit: Emit
  onMeta: (meta: SourceMeta) => void
  onSourceFile: (filePath: string) => void
  onClip: (clip: {
    startSec: number
    endSec: number
    filePath: string
    score?: number | null
    reason?: string | null
    title?: string | null
    description?: string | null
    hashtags?: string | null
  }) => void
  onUsage?: (model: string, usage: Usage) => void
}

export type ReframeFocus = 'center' | 'left' | 'right' | 'face'

export interface PipelineOptions {
  apiKey: string | null
  model: string | null
  transcribe: ((sourceFile: string, sourceId: number) => Promise<Word[]>) | null
  reframeFocus: ReframeFocus
  detectFace: ((sourceFile: string, start: number, end: number) => Promise<number | null>) | null
  cookiesFromBrowser: string | null
  cookiesFile: string | null
  clipCount: number
}

export interface PipelineSource {
  id: number
  url: string
}

const VIDEO_W = 1080
const VIDEO_H = 1920

export async function runPipeline(
  ctx: PipelineContext,
  source: PipelineSource,
  cb: OrchestratorCallbacks,
  opts: PipelineOptions
): Promise<void> {
  const sid = source.id
  const model = opts.model ?? 'claude-haiku-4-5'
  const emit = (stage: JobStage, status: JobStatus, progress: number, message?: string): void =>
    cb.emit({ sourceId: sid, stage, status, progress, message })
  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  // 1) Ingestion
  emit('ingest', 'running', 0, 'Récupération des métadonnées…')
  const meta = await fetchMetadata(ctx, source.url, opts.cookiesFromBrowser, opts.cookiesFile)
  cb.onMeta(meta)
  emit('ingest', 'running', 0.05, `Téléchargement : ${meta.title ?? source.url}`)
  const file = await downloadVideo(
    ctx,
    source.url,
    sid,
    (r) => emit('ingest', 'running', 0.05 + r * 0.9),
    opts.cookiesFromBrowser,
    opts.cookiesFile
  )
  cb.onSourceFile(file)
  emit('ingest', 'done', 1, 'Vidéo téléchargée')

  const duration = meta.durationSec ?? (await probeDuration(ctx, file))

  // 2) Transcription (fail-soft) avec indicateur de temps écoulé
  let words: Word[] | null = null
  if (opts.transcribe) {
    emit('transcribe', 'running', 0, 'Préparation de la transcription…')
    const started = Date.now()
    const hb = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000)
      emit('transcribe', 'running', 0.5, `Transcription en cours… ${s}s`)
    }, 10000)
    try {
      words = await opts.transcribe(file, sid)
      emit('transcribe', 'done', 1, `${words.length} mots transcrits`)
    } catch (e) {
      words = null
      emit('transcribe', 'error', 0, `Transcription échouée : ${errMsg(e)}`)
    } finally {
      clearInterval(hb)
    }
  } else {
    emit('transcribe', 'done', 1, 'Transcription désactivée')
  }

  // 3) Détection des moments forts (fail-soft → segments par défaut)
  let segments: HighlightSegment[] | null = null
  if (words && words.length > 0 && opts.apiKey) {
    emit('highlights', 'running', 0, 'Sélection des moments forts (IA)…')
    try {
      const res = await selectHighlights(words, {
        apiKey: opts.apiKey,
        model: opts.model ?? undefined,
        count: opts.clipCount
      })
      segments = res.segments
      if (res.usage) cb.onUsage?.(model, res.usage)
      emit('highlights', 'done', 1, `${segments.length} moment(s) retenu(s)`)
    } catch (e) {
      segments = null
      emit('highlights', 'error', 0, `IA échouée : ${errMsg(e)}`)
    }
  }
  if (!segments || segments.length === 0) {
    segments = naiveSegments(duration, opts.clipCount).map((s) => ({
      start: s.start,
      end: s.end,
      score: null,
      title: null,
      reason: null
    }))
    emit('highlights', 'done', 1, 'Segments par défaut (clé API ou transcription manquante)')
  }

  // 4) Rendu vertical 9:16 (+ sous-titres) puis métadonnées (description + hashtags)
  emit('reframe', 'running', 0, 'Génération des clips verticaux…')
  let metaCount = 0
  let faceDisabled = false
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const inRange = words && words.length > 0 ? wordsInRange(words, seg.start, seg.end) : []
    let assBasename: string | undefined
    if (inRange.length > 0) {
      assBasename = `${sid}-${i}.ass`
      await writeAss(
        join(ctx.dirs.clips, assBasename),
        buildAss(inRange, { width: VIDEO_W, height: VIDEO_H })
      )
    }

    // Position de recadrage (fail-soft → centré)
    let focusX = 0.5
    if (opts.reframeFocus === 'left') focusX = 0.25
    else if (opts.reframeFocus === 'right') focusX = 0.75
    else if (opts.reframeFocus === 'face' && opts.detectFace && !faceDisabled) {
      console.log(`[reframe] clip ${i}: détection visage (${seg.start.toFixed(1)}→${seg.end.toFixed(1)}s)…`)
      const tFace = Date.now()
      try {
        // Garde-fou absolu : si la détection (init OpenCV comprise) dépasse 18 s,
        // on bascule en centré et on désactive le visage pour le reste de la source.
        let timedOut = false
        const fx = await Promise.race([
          opts.detectFace(file, seg.start, seg.end),
          new Promise<number | null>((r) =>
            setTimeout(() => {
              timedOut = true
              r(null)
            }, 18000)
          )
        ])
        if (fx != null) focusX = fx
        if (timedOut) {
          faceDisabled = true
          console.log(`[reframe] clip ${i}: détection visage > 18s → désactivée (centré) pour le reste`)
          emit('reframe', 'running', i / segments.length, 'Détection visage trop lente → recadrage centré')
        } else {
          console.log(`[reframe] clip ${i}: visage en ${Date.now() - tFace}ms (focusX=${focusX.toFixed(2)})`)
        }
      } catch (e) {
        console.log(`[reframe] clip ${i}: détection échouée (${errMsg(e)}) → centré`)
      }
    }

    const outBasename = `${sid}-${i}.mp4`
    console.log(`[reframe] clip ${i}: rendu ffmpeg…`)
    const tRender = Date.now()
    const out = await renderVerticalClip(ctx, {
      sourceFile: file,
      start: seg.start,
      end: seg.end,
      outBasename,
      assBasename,
      width: VIDEO_W,
      height: VIDEO_H,
      focusX
    })
    console.log(`[reframe] clip ${i}: rendu terminé en ${Date.now() - tRender}ms`)

    // Métadonnées (fail-soft) : description + hashtags
    let description: string | null = null
    let hashtags: string | null = null
    const clipText =
      inRange.length > 0
        ? inRange.map((w) => w.text).join(' ')
        : [seg.title, seg.reason].filter(Boolean).join('. ')
    if (opts.apiKey && clipText.trim()) {
      try {
        emit('metadata', 'running', i / segments.length, `Légende ${i + 1}/${segments.length}`)
        const meta = await generateMetadata({
          apiKey: opts.apiKey,
          model,
          text: clipText,
          title: seg.title
        })
        description = meta.description || null
        hashtags = meta.hashtags.length > 0 ? meta.hashtags.join(' ') : null
        if (meta.usage) cb.onUsage?.(model, meta.usage)
        metaCount++
      } catch (e) {
        emit('metadata', 'error', 0, `Légende échouée : ${errMsg(e)}`)
      }
    }

    cb.onClip({
      startSec: seg.start,
      endSec: seg.end,
      filePath: out,
      score: seg.score,
      reason: seg.reason,
      title: seg.title,
      description,
      hashtags
    })
    emit('reframe', 'running', (i + 1) / segments.length, `Clip ${i + 1}/${segments.length}`)
  }
  emit('reframe', 'done', 1, `${segments.length} clip(s) vertical(aux) prêt(s)`)
  if (opts.apiKey) emit('metadata', 'done', 1, `${metaCount} légende(s) générée(s)`)
}
