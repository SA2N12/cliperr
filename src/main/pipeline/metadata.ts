import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Usage } from './highlights'

const MetaSchema = z.object({
  description: z.string(),
  hashtags: z.array(z.string())
})

export interface MetadataResult {
  description: string
  hashtags: string[]
  usage: Usage | null
}

export interface MetadataOptions {
  apiKey: string
  model?: string
  text: string
  title?: string | null
}

/** Normalise un hashtag : sans espace, préfixé de #. */
function normTag(t: string): string {
  const clean = t.replace(/[#\s]+/g, '')
  return clean ? `#${clean}` : ''
}

/**
 * Génère une description TikTok accrocheuse + des hashtags pour un clip, à
 * partir de son contenu (transcription du segment ou titre/raison).
 */
export async function generateMetadata(opts: MetadataOptions): Promise<MetadataResult> {
  const model = opts.model ?? 'claude-haiku-4-5'
  const client = new Anthropic({ apiKey: opts.apiKey })

  const tool = {
    name: 'write_metadata',
    description: 'Rédige la légende et les hashtags du clip TikTok.',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Légende courte (< 150 caractères), accrocheuse, en français, 0–2 emojis'
        },
        hashtags: {
          type: 'array',
          items: { type: 'string' },
          description: '5 à 8 hashtags pertinents, sans espace'
        }
      },
      required: ['description', 'hashtags']
    }
  } satisfies Anthropic.Tool

  const prompt = `Voici le contenu d'un clip vertical destiné à TikTok${
    opts.title ? ` (titre : « ${opts.title} »)` : ''
  }. Rédige une légende courte et accrocheuse en français (moins de 150 caractères, 0 à 2 emojis) et 5 à 8 hashtags pertinents. Réponds uniquement via l'outil write_metadata.

CONTENU :
${opts.text.slice(0, 4000)}`

  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'write_metadata' },
    messages: [{ role: 'user', content: prompt }]
  })

  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { description: '', hashtags: [], usage }
  const parsed = MetaSchema.safeParse(block.input)
  if (!parsed.success) return { description: '', hashtags: [], usage }

  return {
    description: parsed.data.description.trim(),
    hashtags: parsed.data.hashtags.map(normTag).filter(Boolean),
    usage
  }
}
