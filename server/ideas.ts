import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Usage } from '../src/main/pipeline/highlights'
import type { ViralIdea } from '../src/shared/types'

export type { ViralIdea }

// Génération d'idées de vidéos TikTok virales (Claude) + récupération de
// tendances réelles via une API RapidAPI TikTok. Les tendances récupérées
// servent à « ancrer » les idées générées sur ce qui monte actuellement.

const IdeaSchema = z.object({
  title: z.string(),
  hook: z.string(),
  angle: z.string(),
  script: z.array(z.string()),
  format: z.string(),
  hashtags: z.array(z.string())
})
const IdeasSchema = z.object({ ideas: z.array(IdeaSchema) })

export interface GenerateIdeasOptions {
  apiKey: string
  model?: string
  niche: string
  count: number
  trends?: string[]
}

function normTag(t: string): string {
  const clean = t.replace(/[#\s]+/g, '')
  return clean ? `#${clean}` : ''
}

/** Génère des idées de vidéos virales pour une niche, éventuellement ancrées sur des tendances. */
export async function generateViralIdeas(
  opts: GenerateIdeasOptions
): Promise<{ ideas: ViralIdea[]; usage: Usage | null }> {
  const model = opts.model ?? 'claude-haiku-4-5'
  const client = new Anthropic({ apiKey: opts.apiKey })
  const count = Math.min(8, Math.max(1, Math.round(opts.count)))

  const tool = {
    name: 'propose_ideas',
    description: 'Propose des idées de vidéos TikTok virales.',
    input_schema: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Titre court et accrocheur de la vidéo' },
              hook: { type: 'string', description: "Phrase d'accroche des 3 premières secondes" },
              angle: { type: 'string', description: 'Pourquoi ça peut devenir viral (angle, émotion, curiosité)' },
              script: {
                type: 'array',
                items: { type: 'string' },
                description: 'Déroulé plan par plan, 4 à 8 étapes courtes et concrètes'
              },
              format: { type: 'string', description: 'Format conseillé : durée, style de montage, sous-titres…' },
              hashtags: { type: 'array', items: { type: 'string' }, description: '5 à 8 hashtags pertinents, sans espace' }
            },
            required: ['title', 'hook', 'angle', 'script', 'format', 'hashtags']
          }
        }
      },
      required: ['ideas']
    }
  } satisfies Anthropic.Tool

  const trendsBlock =
    opts.trends && opts.trends.length
      ? `\n\nTENDANCES ACTUELLES À EXPLOITER (inspire-t'en, sans forcer) :\n${opts.trends
          .slice(0, 25)
          .map((t) => `- ${t}`)
          .join('\n')}`
      : ''

  const prompt = `Tu es un stratège de contenu TikTok expert en viralité. Propose ${count} idées de vidéos verticales ORIGINALES et à fort potentiel viral pour la niche/thème : « ${opts.niche} ».${trendsBlock}

Pour chaque idée : un titre accrocheur, un hook (3 premières secondes), l'angle qui la rend virale, un script plan par plan (4 à 8 étapes courtes et concrètes), un format conseillé (durée, style, sous-titres) et 5 à 8 hashtags. Sois concret et actionnable. Réponds en français, uniquement via l'outil propose_ideas.`

  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'propose_ideas' },
    messages: [{ role: 'user', content: prompt }]
  })

  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { ideas: [], usage }
  const parsed = IdeasSchema.safeParse(block.input)
  if (!parsed.success) return { ideas: [], usage }

  return {
    ideas: parsed.data.ideas.map((i) => ({ ...i, hashtags: i.hashtags.map(normTag).filter(Boolean) })),
    usage
  }
}

// ── Tendances réelles via RapidAPI ──

/** Extrait récursivement des noms de hashtags depuis une réponse JSON de forme inconnue. */
function extractHashtags(data: unknown, out: string[], depth = 0): void {
  if (out.length >= 30 || depth > 6 || data == null) return
  if (Array.isArray(data)) {
    for (const x of data) extractHashtags(x, out, depth + 1)
    return
  }
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>
    const nameKey = ['hashtag_name', 'hashtagName', 'hashtag', 'challenge_name', 'title', 'name', 'tag'].find(
      (k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 0
    )
    if (nameKey) {
      const v = String(o[nameKey]).replace(/^#/, '').trim()
      if (v && !/\s{2,}/.test(v) && v.length <= 40 && !out.includes(v)) out.push(v)
    }
    for (const k of Object.keys(o)) extractHashtags(o[k], out, depth + 1)
  }
}

/**
 * Récupère des tendances (hashtags) via une API RapidAPI TikTok. Host et chemin
 * sont configurables (settings `trends_host` / `trends_path`) pour s'adapter à
 * l'API choisie sans redéploiement. Renvoie une liste de hashtags.
 */
export async function fetchTikTokTrends(
  apiKey: string,
  host: string,
  path: string
): Promise<string[]> {
  const url = `https://${host}${path.startsWith('/') ? '' : '/'}${path}`
  const res = await fetch(url, {
    headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': apiKey }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API tendances a répondu ${res.status} : ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as unknown
  const out: string[] = []
  extractHashtags(data, out)
  return out
}
