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

// ── Mode série (feuilleton à épisodes, type « île des fruits skibidi ») ──

export interface SeriesState {
  enabled: boolean
  /** Titre de la série (ex. « L'île des fruits skibidi »). */
  title: string
  /** Univers : personnages récurrents + style visuel, réutilisés à chaque épisode. */
  universe: string
  /** Numéro du prochain épisode à produire (commence à 1). */
  episode: number
  /** Résumé cumulé des épisodes déjà publiés (mémoire de l'histoire). */
  recap: string
}

const EpisodeSchema = z.object({
  title: z.string(),
  hook: z.string(),
  script: z.array(z.string()),
  hashtags: z.array(z.string()),
  recap: z.string()
})

/**
 * Écrit l'épisode suivant d'une série : histoire courte absurde/drôle qui
 * continue l'intrigue (mémoire via `recap`) et finit sur un cliffhanger.
 * Renvoie l'idée prête pour la génération vidéo + le résumé mis à jour.
 */
export async function generateEpisodeIdea(opts: {
  apiKey: string
  model?: string
  series: SeriesState
  /** Tendances TikTok du moment (hashtags) — clin d'œil dans l'épisode si pertinent. */
  trends?: string[]
}): Promise<{ idea: ViralIdea; recap: string; usage: Usage | null }> {
  const model = opts.model ?? 'claude-haiku-4-5'
  const client = new Anthropic({ apiKey: opts.apiKey })
  const s = opts.series
  const n = Math.max(1, s.episode)

  const tool = {
    name: 'write_episode',
    description: 'Écrit le prochain épisode de la série TikTok.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `Titre commençant par « Ép. ${n} — », court et intrigant` },
        hook: { type: 'string', description: 'Accroche des 2 premières secondes (rappel express + relance immédiate)' },
        script: {
          type: 'array',
          items: { type: 'string' },
          description: "Déroulé de l'épisode en 5 à 7 phrases courtes orales (la dernière = cliffhanger + teasing épisode suivant)"
        },
        hashtags: { type: 'array', items: { type: 'string' }, description: '5 à 8 hashtags (dont un hashtag de série stable)' },
        recap: { type: 'string', description: 'Résumé cumulé de TOUTE la série épisodes 1 à ' + n + ' inclus, max 500 caractères (mémoire pour la suite)' }
      },
      required: ['title', 'hook', 'script', 'hashtags', 'recap']
    }
  } satisfies Anthropic.Tool

  const prompt = `Tu écris l'épisode ${n} de la série TikTok « ${s.title} » — format feuilleton court (30-40 s), absurde, drôle et ultra-addictif (style « brainrot » qui cartonne sur TikTok).

UNIVERS ET PERSONNAGES (à respecter strictement, mêmes personnages à chaque épisode) :
${s.universe}

${s.recap ? `RÉSUMÉ DES ÉPISODES PRÉCÉDENTS (continue cette histoire, ne te contredis pas) :\n${s.recap}` : `C'est le PREMIER épisode : pose l'univers et les personnages en quelques secondes, puis lance tout de suite une intrigue.`}
${opts.trends && opts.trends.length ? `\nTENDANCES TIKTOK DU MOMENT (glisse un clin d'œil ou intègre-en une dans l'intrigue SEULEMENT si ça sert l'histoire — jamais au détriment de la continuité) :\n${opts.trends.slice(0, 15).map((t) => `- ${t}`).join('\n')}\n` : ''}
Règles du format :
- Hook : 1 phrase qui replonge instantanément dans l'histoire (« Ép. ${n} : ... »).
- 5 à 7 phrases courtes, orales, tutoiement, énergiques ; une péripétie claire par épisode ; humour absurde assumé.
- DERNIÈRE PHRASE = CLIFFHANGER puissant + teasing (« Épisode ${n + 1} demain... abonne-toi ou tu vas le rater »).
- Écris pour l'ORAL (voix de synthèse française) : nombres en toutes lettres, pas de mots anglais inutiles (« skibidi » et les noms propres de l'univers sont OK).
- \`recap\` : résume toute l'histoire jusqu'à cet épisode inclus (max 500 caractères), c'est la mémoire de la série.

Réponds uniquement via l'outil write_episode.`

  const msg = await client.messages.create({
    model,
    max_tokens: 2500,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'write_episode' },
    messages: [{ role: 'user', content: prompt }]
  })
  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('Épisode non généré — réessaie')
  const parsed = EpisodeSchema.safeParse(block.input)
  if (!parsed.success) throw new Error('Épisode invalide — réessaie')
  const ep = parsed.data
  const idea: ViralIdea = {
    title: ep.title.startsWith('Ép.') ? ep.title : `Ép. ${n} — ${ep.title}`,
    hook: ep.hook,
    angle: `Feuilleton « ${s.title} » : cliffhanger à chaque épisode → abonnements`,
    script: ep.script,
    format: '30-40 s, série verticale, sous-titres incrustés',
    hashtags: ep.hashtags.map(normTag).filter(Boolean)
  }
  return { idea, recap: ep.recap.slice(0, 600), usage }
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
