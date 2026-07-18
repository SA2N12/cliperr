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
  hashtags: z.array(z.string()),
  imageStyle: z.string().optional()
})
const IdeasSchema = z.object({ ideas: z.array(IdeaSchema) })

export interface GenerateIdeasOptions {
  apiKey: string
  model?: string
  niche: string
  count: number
  trends?: string[]
  /** Titres des vidéos déjà publiées sur ce compte — pour éviter de répéter les mêmes sujets. */
  recentTitles?: string[]
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
                description:
                  'Déroulé plan par plan, 4 à 8 étapes courtes et concrètes. La DERNIÈRE étape doit être une question directe ou une affirmation clivante adressée au spectateur pour déclencher des commentaires (ex. « Et toi, tu aurais fait quoi ? », « Je suis le seul à penser ça ? »).'
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

  const avoidBlock =
    opts.recentTitles && opts.recentTitles.length
      ? `\n\n⛔ SUJETS DÉJÀ TRAITÉS RÉCEMMENT SUR CE COMPTE — n'y reviens PAS et ne les reformule pas ; trouve des sujets ET des angles VRAIMENT différents :\n${opts.recentTitles
          .slice(0, 30)
          .map((t) => `- ${t}`)
          .join('\n')}`
      : ''

  const prompt = `Tu es un stratège de contenu TikTok expert en viralité. Propose ${count} idées de vidéos verticales ORIGINALES et à fort potentiel viral pour la niche/thème : « ${opts.niche} ».${trendsBlock}${avoidBlock}

Pour chaque idée : un titre accrocheur, un hook (3 premières secondes), l'angle qui la rend virale, un script plan par plan (4 à 8 étapes courtes et concrètes), un format conseillé (durée, style, sous-titres) et 5 à 8 hashtags.

RÈGLES IMPORTANTES :
- Chaque idée doit être NETTEMENT différente des sujets déjà traités (autre sujet, autre angle, autre accroche). VARIE les formats d'accroche (question, chiffre choc, POV, storytelling, mythe à casser, révélation…) — n'emploie pas toujours la même tournure.
- Ancre chaque idée dans du CONCRET et RECONNAISSABLE : privilégie des sujets CÉLÈBRES et VÉRIFIABLES que le spectateur peut reconnaître ou googler (ex. le manuscrit de Voynich, le col Dyatlov, l'affaire Zodiac, le vol MH370, une étude ou un personnage connus…) + un artefact précis (enregistrement, lettre, document, objet, étude, match…) et une date ou un chiffre EXACT dans le titre. ⛔ ÉVITE ABSOLUMENT les sujets obscurs ou qui « sonnent inventés » (ils ne déclenchent ni recherche, ni commentaire, ni crédibilité → ils plafonnent) et les concepts purement abstraits (ils sous-performent nettement). Un sujet reconnaissable = crédibilité + envie de commenter/vérifier.
- Les DEUX dernières étapes du script doivent déclencher l'ENGAGEMENT : (a) une question directe ou une affirmation clivante adressée au spectateur (→ COMMENTAIRES : « Accident ou dissimulation ? Ton avis en commentaire »), ET (b) une raison de PARTAGER (« Envoie ça à quelqu'un qui refuse de croire à… », « Taggue celui qui… ») — le PARTAGE est le signal le plus puissant pour l'algorithme, priorise-le.

Sois concret et actionnable. Réponds en français, uniquement via l'outil propose_ideas.`

  // On retente jusqu'à 3 fois : un résultat vide (refus ponctuel, réponse tronquée
  // ou hors-schéma) est généralement transitoire → un nouvel essai aboutit.
  let ideas: ViralIdea[] = []
  let usageIn = 0
  let usageOut = 0
  let hasUsage = false
  for (let attempt = 0; attempt < 3 && !ideas.length; attempt++) {
    const msg = await client.messages.create({
      model,
      max_tokens: 4000,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'propose_ideas' },
      messages: [{ role: 'user', content: prompt }]
    })
    if (msg.usage) {
      usageIn += msg.usage.input_tokens
      usageOut += msg.usage.output_tokens
      hasUsage = true
    }
    const block = msg.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') continue
    const parsed = IdeasSchema.safeParse(block.input)
    if (!parsed.success) continue
    ideas = parsed.data.ideas.map((i) => ({ ...i, hashtags: i.hashtags.map(normTag).filter(Boolean) }))
  }
  return { ideas, usage: hasUsage ? { input_tokens: usageIn, output_tokens: usageOut } : null }
}

// ── Mode inspiration : vidéo ORIGINALE calquée sur la mécanique d'un TikTok qui marche ──

export interface InspireOptions {
  apiKey: string
  model?: string
  /** Vidéo source (métadonnées yt-dlp + transcription de la voix). */
  source: { title: string | null; author: string | null; durationSec: number | null; transcript: string }
  /** Niche cible (optionnel) — sinon l'idée reste sur le même thème que la source. */
  niche?: string
  /** Captures d'écran de la vidéo source (JPEG base64) → analyse du style visuel. */
  frames?: string[]
  /** 'reproduce' = clone fidèle (même sujet/structure/déroulé/style) ; 'inspire' = original. */
  mode?: 'reproduce' | 'inspire'
}

/**
 * Analyse un TikTok viral (transcription + méta) et écrit UNE idée ORIGINALE qui
 * réutilise sa mécanique gagnante (hook, structure, levier émotionnel) sans en
 * copier le contenu. Inspiration structurelle, pas plagiat.
 */
export async function generateInspiredIdea(opts: InspireOptions): Promise<{ idea: ViralIdea | null; usage: Usage | null }> {
  const model = opts.model ?? 'claude-haiku-4-5'
  const client = new Anthropic({ apiKey: opts.apiKey })
  const reproduce = opts.mode === 'reproduce'

  const tool = {
    name: 'propose_idea',
    description: reproduce ? 'Reconstitue fidèlement la vidéo source pour la reproduire.' : 'Propose une idée de vidéo TikTok originale inspirée de la mécanique de la source.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: reproduce ? 'Titre reprenant le sujet de la vidéo source' : 'Titre court et accrocheur de la NOUVELLE vidéo' },
        hook: { type: 'string', description: reproduce ? "L'accroche des 3 premières secondes de la SOURCE (fidèle)" : "Phrase d'accroche des 3 premières secondes" },
        angle: { type: 'string', description: reproduce ? 'Résume ce que fait la vidéo source (sujet + structure)' : 'Commence par « Mécanique reprise : … » (ce qui est gardé de la source), puis pourquoi ça peut devenir viral' },
        script: {
          type: 'array',
          items: { type: 'string' },
          description: reproduce
            ? "Le déroulé EXACT de la source, un plan/moment par étape, dans l'ORDRE de la vidéo (autant d'étapes qu'il y a de moments distincts). Reste fidèle au contenu, aux exemples et à la chute de la source ; reformule juste en français oral propre. GARDE le hook d'origine en 1re étape et la chute d'origine en dernière."
            : 'Déroulé plan par plan, 4 à 8 étapes courtes et concrètes. La DERNIÈRE étape doit être une question directe ou une affirmation clivante adressée au spectateur pour déclencher des commentaires.'
        },
        format: { type: 'string', description: 'Format conseillé : durée, style de montage, sous-titres…' },
        hashtags: { type: 'array', items: { type: 'string' }, description: '5 à 8 hashtags pertinents, sans espace' },
        imageStyle: {
          type: 'string',
          description:
            "Style visuel de la vidéo source, décrit en ANGLAIS (2-3 phrases) comme consigne de génération d'images : type de visuel (photo réaliste, image IA stylisée, dessin, 3D, archive…), palette de couleurs, éclairage, ambiance, composition. Décris uniquement l'ESTHÉTIQUE transposable à des images fixes générées — pas le format vidéo (pas de « personne face caméra », pas de « montage rapide »)."
        }
      },
      required: ['title', 'hook', 'angle', 'script', 'format', 'hashtags', 'imageStyle']
    }
  } satisfies Anthropic.Tool

  const s = opts.source
  const transcript = s.transcript.slice(0, 8000)
  const frames = (opts.frames ?? []).slice(0, 5)
  const srcBlock = `Auteur : ${s.author ?? 'inconnu'}
Titre / légende : ${s.title ?? '(sans titre)'}
Durée : ${s.durationSec ? `${Math.round(s.durationSec)} s` : 'inconnue'}
Transcription de la voix : ${transcript ? `« ${transcript} »` : '(aucune parole détectée — vidéo probablement visuelle/musicale : appuie-toi sur la légende et les captures)'}`

  const prompt = reproduce
    ? `Tu es monteur TikTok. On veut REPRODUIRE FIDÈLEMENT cette vidéo qui marche${frames.length ? ' (captures d’écran ci-jointes, dans l’ordre)' : ''} : même sujet, même déroulé, même chute, même style. On ne cherche PAS à faire différent.

${srcBlock}

ÉTAPE 1 — Reconstitue le déroulé EXACT de la source : découpe la transcription en moments/plans successifs, dans l'ordre, sans rien inventer, sans réorganiser, sans « améliorer ». Le champ « script » = ce déroulé (une étape par moment), fidèle au contenu, aux exemples et à la chute. Reformule seulement pour un français oral propre (nombres en toutes lettres, phrases courtes). Garde le hook d'origine et la chute d'origine.
ÉTAPE 2 — Décris le STYLE VISUEL de la source (champ imageStyle, en anglais)${frames.length ? ', d’après les captures' : ''} pour régénérer des images IA dans CE style à l'identique.

RÈGLES :
- On REPRODUIT, on ne transforme pas : ne change ni le sujet, ni les exemples, ni la chute. N'ajoute PAS de question/CTA « à la TikTok » si la source n'en a pas.
- imageStyle : ne décris JAMAIS d'enfant/mineur ni de personne réelle identifiable (le générateur d'images les refuse).

Réponds en français (imageStyle en anglais), uniquement via l'outil propose_idea.`
    : `Tu es un stratège de contenu TikTok expert en viralité. Voici une vidéo TikTok qui fonctionne, dont on veut S'INSPIRER${frames.length ? ' (captures d’écran ci-jointes, dans l’ordre chronologique)' : ''} :

${srcBlock}

ÉTAPE 1 — Analyse sa MÉCANIQUE virale : type de hook, structure narrative, rythme, levier émotionnel (curiosité, indignation, identification, surprise…), format.
ÉTAPE 2 — Analyse son STYLE VISUEL${frames.length ? ' à partir des captures' : ' probable (d’après la légende et le thème)'} : type de visuels, palette, éclairage, ambiance, composition → champ imageStyle (en anglais). La nouvelle vidéo sera générée en images IA dans CE style.
ÉTAPE 3 — Crée UNE vidéo ORIGINALE qui réutilise cette mécanique gagnante, ${opts.niche ? `adaptée à la niche/thème : « ${opts.niche} »` : 'sur le même thème général que la source'}.

RÈGLES IMPORTANTES :
- INTERDIT de copier la source : autre sujet précis, autres phrases, autres exemples, autre chute. On reprend la STRUCTURE, le levier émotionnel et le STYLE VISUEL, jamais le contenu. Les deux vidéos doivent pouvoir coexister sans soupçon de plagiat.
- Ancre l'idée dans du CONCRET : un artefact précis (enregistrement, document, photo, objet, étude, match…) et/ou une date ou un chiffre EXACT dans le titre — les titres concrets et datés surperforment.
- Dans « angle », commence par « Mécanique reprise : … » (une phrase sur ce que tu gardes de la source).
- La DERNIÈRE étape du script = question directe ou affirmation clivante adressée au spectateur (déclencheur de commentaires).
- imageStyle : ne décris JAMAIS d'enfant/mineur ni de personne réelle identifiable (le générateur d'images les refuse).

Réponds en français (imageStyle en anglais), uniquement via l'outil propose_idea.`

  const content: Anthropic.ContentBlockParam[] = [
    ...frames.map((data): Anthropic.ImageBlockParam => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data }
    })),
    { type: 'text', text: prompt }
  ]

  let idea: ViralIdea | null = null
  let usageIn = 0
  let usageOut = 0
  let hasUsage = false
  for (let attempt = 0; attempt < 3 && !idea; attempt++) {
    const msg = await client.messages.create({
      model,
      max_tokens: 3000,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'propose_idea' },
      messages: [{ role: 'user', content }]
    })
    if (msg.usage) {
      usageIn += msg.usage.input_tokens
      usageOut += msg.usage.output_tokens
      hasUsage = true
    }
    const block = msg.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') continue
    const parsed = IdeaSchema.safeParse(block.input)
    if (!parsed.success) continue
    idea = { ...parsed.data, hashtags: parsed.data.hashtags.map(normTag).filter(Boolean), reproduce }
  }
  return { idea, usage: hasUsage ? { input_tokens: usageIn, output_tokens: usageOut } : null }
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
          description: "Déroulé de l'épisode en 5 à 7 RÉPLIQUES de dialogue entre les personnages, format « Nom : réplique » (la dernière = cliffhanger + teasing épisode suivant)"
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
- L'épisode est joué en DIALOGUES : les personnages parlent entre eux (pas de narrateur). Chaque ligne du script = « Nom : réplique » (courte, très orale, pleine d'émotion — cris, chuchotements, panique, rires).
- Hook : la 1re réplique replonge instantanément dans l'histoire et accroche.
- 5 à 7 répliques ; une péripétie claire par épisode ; humour absurde assumé.
- DERNIÈRE RÉPLIQUE = CLIFFHANGER puissant dit par un personnage (+ teasing épisode ${n + 1}).
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
