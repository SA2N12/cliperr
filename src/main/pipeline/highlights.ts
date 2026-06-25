import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Word } from './transcribe'

export interface HighlightSegment {
  start: number
  end: number
  score: number | null
  title: string | null
  reason: string | null
}

export interface Usage {
  input_tokens: number
  output_tokens: number
}

export interface HighlightResult {
  segments: HighlightSegment[]
  usage: Usage | null
}

const ClipsSchema = z.object({
  clips: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      score: z.number(),
      title: z.string(),
      reason: z.string()
    })
  )
})

/** Transcription compacte : une ligne ~12 mots préfixée par son timecode. */
function buildTranscriptText(words: Word[], maxChars = 120000): string {
  const lines: string[] = []
  for (let i = 0; i < words.length; i += 12) {
    const chunk = words.slice(i, i + 12)
    lines.push(`[${chunk[0].start.toFixed(1)}] ${chunk.map((w) => w.text).join(' ')}`)
  }
  const text = lines.join('\n')
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

export interface HighlightOptions {
  apiKey: string
  model?: string
  count?: number
  minDur?: number
  maxDur?: number
}

/**
 * Sélectionne les meilleurs moments via l'API Claude (tool-use forcé pour une
 * sortie structurée fiable). Lève si l'appel échoue — l'orchestrateur retombe
 * alors sur des segments par défaut.
 */
export async function selectHighlights(
  words: Word[],
  opts: HighlightOptions
): Promise<HighlightResult> {
  if (words.length === 0) return { segments: [], usage: null }
  const model = opts.model ?? 'claude-opus-4-8'
  const count = opts.count ?? 3
  const minDur = opts.minDur ?? 20
  const maxDur = opts.maxDur ?? 60
  const client = new Anthropic({ apiKey: opts.apiKey })

  const tool = {
    name: 'select_clips',
    description: 'Renvoie les meilleurs moments à transformer en clips verticaux TikTok.',
    input_schema: {
      type: 'object',
      properties: {
        clips: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              start: { type: 'number', description: 'début en secondes' },
              end: { type: 'number', description: 'fin en secondes' },
              score: { type: 'number', description: 'potentiel viral 0..1' },
              title: { type: 'string', description: 'titre accrocheur court' },
              reason: { type: 'string', description: 'pourquoi ce moment marche' }
            },
            required: ['start', 'end', 'score', 'title', 'reason']
          }
        }
      },
      required: ['clips']
    }
  } satisfies Anthropic.Tool

  const prompt = `Voici la transcription horodatée (en secondes) d'une vidéo longue. Sélectionne les ${count} meilleurs moments autonomes et accrocheurs pour des clips TikTok verticaux.

Contraintes :
- chaque clip dure entre ${minDur} et ${maxDur} secondes ;
- il commence et finit sur des frontières naturelles de phrase ;
- il se comprend seul, sans contexte ;
- privilégie l'émotion, l'humour, les punchlines, les révélations.

Réponds uniquement via l'outil select_clips.

TRANSCRIPTION :
${buildTranscriptText(words)}`

  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'select_clips' },
    messages: [{ role: 'user', content: prompt }]
  })

  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { segments: [], usage }
  const parsed = ClipsSchema.safeParse(block.input)
  if (!parsed.success) return { segments: [], usage }

  const segments = parsed.data.clips
    .map((c) => {
      const start = Math.max(0, Math.min(c.start, c.end))
      let end = Math.max(c.start, c.end)
      if (end - start > maxDur) end = start + maxDur
      if (end - start < 1) end = start + minDur
      return { start, end, score: c.score, title: c.title, reason: c.reason }
    })
    .slice(0, count)
  return { segments, usage }
}
