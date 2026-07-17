import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { run, runCapture, type PipelineContext } from '../src/main/pipeline/context'
import type { Usage } from '../src/main/pipeline/highlights'
import type { ViralIdea } from '../src/shared/types'

// Génération d'une vidéo « faceless » 9:16 à partir d'une idée :
// storyboard (Claude) → voix off (OpenAI TTS) + image IA par scène (DALL·E) →
// montage ffmpeg (Ken Burns + sous-titres incrustés) → MP4 vertical.

const OPENAI = 'https://api.openai.com/v1'

const SceneSchema = z.object({ narration: z.string(), imagePrompt: z.string(), speaker: z.string().optional() })
const CastSchema = z.object({ name: z.string(), voice: z.string(), style: z.string() })
const StoryboardSchema = z.object({ scenes: z.array(SceneSchema), cast: z.array(CastSchema).optional() })
export interface Scene {
  narration: string
  imagePrompt: string
  /** Mode dialogue : nom du personnage qui dit la réplique. */
  speaker?: string
}
export interface CastMember {
  name: string
  voice: string
  style: string
}
/** Voix disponibles côté OpenAI TTS (gpt-4o-mini-tts). */
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']

export interface VideoGenOptions {
  anthropicKey: string
  anthropicModel?: string
  openaiKey: string
  voice?: string
  idea: ViralIdea
  /** Chemin d'une musique de fond (libre de droits) à mixer sous la voix. */
  musicTrack?: string
  /** Univers visuel imposé (mode série) : personnages récurrents + style, injecté dans chaque image. */
  imageStyle?: string
  /** Clé Gemini (Nano Banana) : images de série avec personnages RÉELLEMENT cohérents. */
  geminiKey?: string | null
  /** Planche de référence des personnages (png) — utilisée par Nano Banana à chaque scène. */
  characterRefPath?: string
  /** Clé fal.ai : anime chaque scène (image → clip vidéo) au lieu du zoom Ken Burns. */
  falKey?: string | null
  /** Modèle fal.ai (image-to-video) — défaut Seedance lite. */
  falVideoModel?: string
  /** Active l'animation vidéo des scènes (mode série). */
  animateScenes?: boolean
  /** Mode dialogue : les personnages parlent (voix + intonation par personnage), pas de narrateur. */
  dialogue?: boolean
  /** Moteur d'animation des séries : 'veo' = scènes parlées Veo (voix native + lipsync), sinon fal.ai + TTS. */
  videoEngine?: string
  onProgress?: (msg: string) => void
}

/** Découpe l'idée en 4–6 scènes (voix off FR + prompt image EN) via Claude. */
async function buildStoryboard(
  key: string,
  model: string,
  idea: ViralIdea,
  styleHint?: string,
  dialogue?: boolean
): Promise<{ scenes: Scene[]; cast: CastMember[]; usage: Usage | null }> {
  const client = new Anthropic({ apiKey: key })
  const sceneProps: Record<string, unknown> = {
    narration: {
      type: 'string',
      description: dialogue
        ? 'La RÉPLIQUE du personnage en français : courte (2 à 14 mots), très orale et expressive (interjections, exclamations). L\'histoire doit se comprendre uniquement par les répliques.'
        : 'Une phrase de voix off en français : courte (≤ 18 mots), orale, percutante, tutoiement. La 1re est un hook choc qui crée une tension immédiate ; la dernière est une punchline + appel à l\'action.'
    },
    imagePrompt: {
      type: 'string',
      description:
        'Description visuelle en anglais, très cinématographique et dramatique (éclairage travaillé, ambiance, angle fort), pour une image verticale ; AUCUN texte, logo ni watermark' +
        (dialogue ? ' ; le personnage qui parle est au premier plan, bouche ouverte, très expressif' : '')
    }
  }
  if (dialogue) {
    sceneProps.speaker = { type: 'string', description: 'Nom EXACT du personnage qui dit la réplique (doit figurer dans le casting)' }
  }
  const properties: Record<string, unknown> = {
    scenes: {
      type: 'array',
      items: { type: 'object', properties: sceneProps, required: dialogue ? ['narration', 'imagePrompt', 'speaker'] : ['narration', 'imagePrompt'] }
    }
  }
  if (dialogue) {
    properties.cast = {
      type: 'array',
      description: 'Casting vocal : un membre par personnage qui parle dans cet épisode',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du personnage' },
          voice: { type: 'string', enum: OPENAI_VOICES, description: 'Voix TTS attribuée — varie les timbres entre personnages (graves, aiguës…)' },
          style: { type: 'string', description: 'Comment il parle, en français : timbre, débit, émotion, tics de langage (ex. « voix grave et lente, très bête, rit à la fin de ses phrases »)' }
        },
        required: ['name', 'voice', 'style']
      }
    }
  }
  const tool = {
    name: 'storyboard',
    description: 'Découpe une idée de vidéo TikTok en scènes (voix + visuel).',
    input_schema: { type: 'object', properties, required: dialogue ? ['cast', 'scenes'] : ['scenes'] }
  } as Anthropic.Tool

  const prompt = `Tu es un scénariste TikTok expert en RÉTENTION et en viralité. Transforme cette idée en storyboard de 4 à 5 scènes pour une vidéo verticale « faceless » COURTE de 20 à 28 secondes (la brièveté maximise le taux de complétion — le signal n°1 de l'algorithme TikTok pour être re-poussé au-delà du 1er lot de vues).
Titre : ${idea.title}
Hook : ${idea.hook}
Script de départ : ${idea.script.join(' ')}

Règles de rétention (déterminantes pour la performance et les revenus TikTok) :
- SCÈNE 1 = HOOK CHOC dès la 1re seconde : tension/curiosité irrésistible (question intrigante, affirmation surprenante, « Personne ne sait que… »). Jamais de démarrage mou ni de « Aujourd'hui on va parler de… ».
- Ouvre une BOUCLE au début (promesse implicite) et ne la referme qu'à la toute fin → donne envie de rester jusqu'au bout.
- Rythme rapide : 1 idée = 1 scène = 1 phrase courte, orale, percutante. Zéro remplissage.
- Monte en intensité ; garde l'info la plus forte (le payoff) pour l'avant-dernière scène.
- DERNIÈRE scène = soit une BOUCLE sur la toute première seconde (la dernière phrase renvoie ou répond au hook d'ouverture → la vidéo se re-regarde en boucle sans couture, énorme signal de watch-time), soit un cliffhanger (pour les séries) — PLUS un déclencheur d'engagement : une question qui divise (« Accident ou dissimulation ? Dis-le en commentaire ») OU une incitation au PARTAGE (« Envoie ça à quelqu'un qui… »). Évite le simple « Abonne-toi » : commentaire, partage et rewatch pèsent beaucoup plus lourd.
- Ton : tutoiement, énergique, immersif, comme si tu parlais à un pote.
- ÉCRIS POUR L'ORAL (le texte est lu par une voix de synthèse française) : nombres en toutes lettres (« mille neuf cent douze »), pas de sigles ambigus, pas de mots anglais inutiles, ponctuation naturelle.
${styleHint && dialogue ? `\nUNIVERS VISUEL IMPOSÉ (série à personnages récurrents — décris CES personnages et CE style dans CHAQUE imagePrompt, de façon identique d'une scène à l'autre) : ${styleHint}\n` : ''}${styleHint && !dialogue ? `\nSTYLE VISUEL IMPOSÉ (repris de la vidéo dont on s'inspire — décris CE style dans CHAQUE imagePrompt, identique d'une scène à l'autre) : ${styleHint}\n` : ''}${dialogue ? '' : `
RÈGLES IMAGE IMPÉRATIVES (le générateur d'images REFUSE ces contenus — la vidéo échouerait entièrement) :
- Aucun imagePrompt ne doit représenter un ENFANT ou un MINEUR, même de dos, même en silhouette, même sur une photo d'archive. Si le sujet en implique un (étude sur l'enfance, école, jeune cobaye, souvenir d'enfance…), illustre la scène AUTREMENT : l'objet seul posé sur une table, une main d'ADULTE, la pièce vide, un jouet abandonné, un document/dossier d'archive, un vieux moniteur, une silhouette d'adulte, un symbole. C'est souvent PLUS fort visuellement.
- Pas de personne réelle identifiable (célébrité, personnalité politique), pas de gore, pas de contenu sexuel ou violent explicite.
`}
${dialogue ? `FORMAT DIALOGUE — PAS DE NARRATEUR :
- Chaque scène = UNE réplique d'UN personnage de l'univers (champ speaker). Les personnages se répondent, l'histoire avance uniquement par leurs échanges.
- Répliques courtes, vivantes, pleines d'émotion (cris, chuchotements, rires, panique…). La dernière réplique = le cliffhanger.
- CASTING : pour chaque personnage qui parle, choisis une voix TTS différente (varie graves/aiguës selon le physique du personnage) et décris précisément son intonation dans « style » — c'est ce qui fait vivre les personnages.
` : ''}
Pour chaque scène : ${dialogue ? 'la RÉPLIQUE (speaker + narration)' : 'la phrase de VOIX OFF (français, courte, orale)'} + un IMAGE PROMPT en anglais ${styleHint ? 'respectant STRICTEMENT le style visuel imposé ci-dessus, très détaillé' : 'décrivant un visuel vertical ULTRA-cinématographique, dramatique et très détaillé (éclairage volumétrique, ambiance, angle fort, couleurs riches)'}, sans aucun texte. Réponds uniquement via l'outil storyboard.`

  const msg = await client.messages.create({
    model,
    max_tokens: 3000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'storyboard' },
    messages: [{ role: 'user', content: prompt }]
  })
  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { scenes: [], cast: [], usage }
  const parsed = StoryboardSchema.safeParse(block.input)
  if (!parsed.success) return { scenes: [], cast: [], usage }
  return { scenes: parsed.data.scenes.slice(0, 8), cast: parsed.data.cast ?? [], usage }
}

// Ambiances disponibles (préfixe du nom de fichier) + indice de contexte pour l'IA.
const MOOD_HINTS: Record<string, string> = {
  dark: 'sombre, mystère, suspense, tension, effrayant, crime',
  epic: 'épique, grandiose, historique, dramatique, récit intense',
  hype: 'énergique, rapide, hype, buzz, tendance, punchy',
  uplift: 'positif, motivant, inspirant, lumineux, feel-good',
  chill: 'calme, doux, posé, réfléchi, focus, psychologie'
}
const moodOf = (file: string): string => file.split('-')[0]
const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/**
 * Choisit une musique ADAPTÉE au contenu (ambiance via Claude) puis VARIÉE :
 * tirage aléatoire dans le groupe d'ambiance, en évitant le dernier morceau
 * utilisé (`exclude`) pour ne pas remettre le même deux fois de suite.
 */
export async function chooseMusicTrack(
  key: string,
  model: string,
  idea: ViralIdea,
  tracks: string[],
  exclude?: string | null
): Promise<string | null> {
  if (!tracks.length) return null
  if (tracks.length === 1) return tracks[0]

  const moods = [...new Set(tracks.map(moodOf))]
  let mood: string | null = null
  try {
    const client = new Anthropic({ apiKey: key })
    const tool = {
      name: 'pick_mood',
      description: 'Choisit l’ambiance musicale la plus adaptée à la vidéo.',
      input_schema: {
        type: 'object',
        properties: { mood: { type: 'string', enum: moods, description: 'Ambiance la plus adaptée' } },
        required: ['mood']
      }
    } satisfies Anthropic.Tool
    const hints = moods.map((m) => `- ${m} : ${MOOD_HINTS[m] ?? m}`).join('\n')
    const prompt = `Choisis l’ambiance musicale la plus adaptée à cette vidéo TikTok.
Titre : ${idea.title}
Hook : ${idea.hook}
Contenu : ${idea.script.join(' ')}

Ambiances possibles :
${hints}

Réponds via l’outil pick_mood.`
    const msg = await client.messages.create({
      model,
      max_tokens: 120,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'pick_mood' },
      messages: [{ role: 'user', content: prompt }]
    })
    const block = msg.content.find((b) => b.type === 'tool_use')
    if (block && block.type === 'tool_use') {
      const m = (block.input as { mood?: string }).mood
      if (typeof m === 'string' && moods.includes(m)) mood = m
    }
  } catch {
    /* échec IA : on tire dans toute la bibliothèque */
  }

  let pool = mood ? tracks.filter((t) => moodOf(t) === mood) : tracks
  if (!pool.length) pool = tracks
  // On évite de rejouer le dernier morceau si une alternative existe.
  const varied = pool.filter((t) => t !== exclude)
  return pickRandom(varied.length ? varied : pool)
}

/**
 * Voix off OpenAI → fichier mp3. Modèle `gpt-4o-mini-tts` : prononciation
 * française nettement meilleure + pilotable par consignes (ton, débit).
 * Repli automatique sur `tts-1-hd` si le modèle n'est pas disponible.
 */
async function tts(openaiKey: string, voice: string, text: string, dest: string, characterStyle?: string): Promise<void> {
  const instructions = characterStyle
    ? `Tu es un doubleur professionnel de dessin animé. Français de France, prononciation native impeccable. Tu joues ce personnage : ${characterStyle}. Intonation TRÈS expressive et théâtrale, émotions marquées, vivant.`
    : 'Parle en français de France avec une prononciation native impeccable (liaisons naturelles, nombres et noms propres bien articulés). Ton de créateur TikTok : énergique, complice, vivant. Débit soutenu mais parfaitement intelligible.'
  let res = await fetch(`${OPENAI}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input: text,
      response_format: 'mp3',
      instructions
    })
  })
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    res = await fetch(`${OPENAI}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', voice, input: text, response_format: 'mp3', speed: 1.08 })
    })
  }
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status} : ${(await res.text()).slice(0, 200)}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

/** Rejet du filtre de sécurité OpenAI (le plus souvent : un mineur dans la scène). */
function isSafetyRejection(status: number, body: string): boolean {
  return status === 400 && /safety system|content[_ ]policy|moderation/i.test(body)
}

/**
 * Retire toute présence humaine d'un prompt d'image. Le filtre d'OpenAI refuse
 * notamment les mineurs : plutôt que de perdre la vidéo entière, on regénère le
 * visuel sur le seul décor + les objets (souvent tout aussi cinématographique).
 */
function neutralizeImagePrompt(prompt: string): string {
  const noPeople = prompt
    // On avale aussi l'article/adjectif qui précède (« a young child » → ∅),
    // sinon il reste des fragments du genre « a young sitting alone ».
    .replace(
      /\b(?:(?:a|an|the|one|two|three|several|some|his|her|their|young|little|small|tiny|old|elderly)\s+)*(?:children|child|kids?|boys?|girls?|bab(?:y|ies)|toddlers?|infants?|minors?|teenagers?|teens?|schoolchild(?:ren)?|pupils?|students?|sons?|daughters?|famil(?:y|ies)|people|persons?|humans?|man|men|woman|women|crowds?|faces?|silhouettes?)(?:'s)?\b/gi,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/(^|[,.])\s*(?:of|the|a|an)\s+(?=[,.]|$)/gi, '$1')
    .replace(/([,.])\s*(?=[,.])/g, '')
    .replace(/^[\s,.]+/, '')
    .trim()
  return `${noPeople}. Empty scene showing ONLY the setting and the objects — absolutely no people, no human figures, no faces, no silhouettes, no body parts. Cinematic still life.`
}

/**
 * Image IA verticale (gpt-image-1, 1024×1536) → fichier png. Gère réponse b64 OU url.
 * `keepStyle` : le prompt impose déjà son propre style (mode inspiration/série) → on
 * n'ajoute PAS le suffixe « photoréaliste cinématique » qui l'écraserait.
 */
async function genImage(openaiKey: string, prompt: string, dest: string, onNote?: (m: string) => void, keepStyle = false): Promise<void> {
  const suffix = keepStyle
    ? 'Vertical 9:16 composition, highly detailed, no text, no watermark, no logo.'
    : 'Vertical 9:16, ultra-cinematic, dramatic volumetric lighting, rich saturated colors, shallow depth of field, highly detailed, photorealistic film still, epic mood, no text, no watermark, no logo.'
  const call = (p: string): Promise<Response> =>
    fetch(`${OPENAI}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: `${p}. ${suffix}`,
        size: '1024x1536',
        quality: 'medium',
        n: 1
      })
    })
  let res = await call(prompt)
  if (!res.ok) {
    const body = await res.text()
    if (!isSafetyRejection(res.status, body)) throw new Error(`OpenAI image ${res.status} : ${body.slice(0, 200)}`)
    // Scène bloquée par le filtre : on retente SANS aucun personnage plutôt que
    // de faire échouer toute la vidéo.
    onNote?.('Image refusée par le filtre de sécurité — nouvelle tentative sans personnage…')
    res = await call(neutralizeImagePrompt(prompt))
    if (!res.ok) {
      throw new Error(`OpenAI image ${res.status} (repli sans personnage aussi refusé) : ${(await res.text()).slice(0, 160)}`)
    }
  }
  const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
  const item = j.data?.[0]
  if (item?.b64_json) {
    await writeFile(dest, Buffer.from(item.b64_json, 'base64'))
    return
  }
  if (item?.url) {
    const r = await fetch(item.url)
    if (!r.ok) throw new Error(`Téléchargement image ${r.status}`)
    await writeFile(dest, Buffer.from(await r.arrayBuffer()))
    return
  }
  throw new Error('OpenAI image : réponse vide')
}

// ── Nano Banana (Gemini) : génération d'images avec personnages cohérents ──
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Génère une image via Gemini (« Nano Banana »). Si `refPath` est fourni,
 * l'image de référence est jointe : le modèle réutilise EXACTEMENT les mêmes
 * personnages/style — c'est sa spécialité, idéale pour les séries.
 */
export async function genImageGemini(
  key: string,
  prompt: string,
  dest: string,
  refPath?: string
): Promise<void> {
  const parts: Record<string, unknown>[] = [{ text: prompt }]
  if (refPath) {
    const b64 = (await readFile(refPath)).toString('base64')
    parts.push({ inlineData: { mimeType: 'image/png', data: b64 } })
  }
  const res = await fetch(`${GEMINI}/models/gemini-2.5-flash-image:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  })
  if (!res.ok) throw new Error(`Gemini image ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
  }
  const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new Error('Gemini image : réponse vide')
  await writeFile(dest, Buffer.from(b64, 'base64'))
}

// ── fal.ai : animation d'une scène (image → clip vidéo) ──
// File d'attente fal.ai : on soumet la requête, on interroge le statut, puis on
// télécharge le clip. Modèle par défaut : Seedance lite (excellent rapport
// qualité/prix ~0,18 $ le clip 5 s en 720p), changeable via le setting
// `fal_video_model` sans redéploiement.
const FAL_QUEUE = 'https://queue.fal.run'
export const FAL_DEFAULT_MODEL = 'fal-ai/bytedance/seedance/v1/lite/image-to-video'

async function genVideoFal(
  falKey: string,
  prompt: string,
  dest: string,
  refImagePath: string,
  model: string = FAL_DEFAULT_MODEL,
  durationSec: '5' | '10' = '5'
): Promise<void> {
  const auth = { Authorization: `Key ${falKey}` }
  const imageB64 = (await readFile(refImagePath)).toString('base64')
  const submit = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_url: `data:image/png;base64,${imageB64}`,
      resolution: '720p',
      duration: durationSec
    })
  })
  if (!submit.ok) throw new Error(`fal.ai ${submit.status} : ${(await submit.text()).slice(0, 160)}`)
  const sub = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string }
  if (!sub.request_id) throw new Error('fal.ai : réponse sans request_id')
  const statusUrl = sub.status_url ?? `${FAL_QUEUE}/${model}/requests/${sub.request_id}/status`
  const resultUrl = sub.response_url ?? `${FAL_QUEUE}/${model}/requests/${sub.request_id}`

  const t0 = Date.now()
  for (;;) {
    if (Date.now() - t0 > 8 * 60 * 1000) throw new Error('fal.ai : délai dépassé')
    await new Promise((r) => setTimeout(r, 6000))
    const st = await fetch(statusUrl, { headers: auth })
    if (!st.ok) throw new Error(`fal.ai suivi ${st.status}`)
    const sj = (await st.json()) as { status?: string }
    if (sj.status === 'FAILED' || sj.status === 'ERROR') throw new Error('fal.ai : génération échouée')
    if (sj.status !== 'COMPLETED') continue
    const rr = await fetch(resultUrl, { headers: auth })
    if (!rr.ok) throw new Error(`fal.ai résultat ${rr.status}`)
    const j = (await rr.json()) as { video?: { url?: string } }
    const url = j.video?.url
    if (!url) throw new Error('fal.ai : réponse sans vidéo')
    const dl = await fetch(url)
    if (!dl.ok) throw new Error(`fal.ai téléchargement ${dl.status}`)
    await writeFile(dest, Buffer.from(await dl.arrayBuffer()))
    return
  }
}

// ── Veo (Gemini) : scène PARLÉE — le personnage prononce sa réplique avec
// voix native + lipsync + bruitages, à partir de l'image de la scène. ──
const VEO_MODELS = ['veo-3.1-fast-generate-001', 'veo-3.1-fast-generate-preview', 'veo-3.0-fast-generate-001']
let veoModelCache: string | null = null

export async function genVideoVeoTalking(
  key: string,
  prompt: string,
  dest: string,
  refImagePath: string,
  durationSec: 4 | 6 | 8 = 8
): Promise<void> {
  const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' }
  const instance: Record<string, unknown> = {
    prompt,
    image: { bytesBase64Encoded: (await readFile(refImagePath)).toString('base64'), mimeType: 'image/png' }
  }
  const models = veoModelCache ? [veoModelCache] : VEO_MODELS
  let opName: string | null = null
  let lastErr = ''
  for (const m of models) {
    // Certains déploiements refusent durationSeconds → on retente sans.
    for (const params of [{ aspectRatio: '9:16', durationSeconds: durationSec }, { aspectRatio: '9:16' }]) {
      const r = await fetch(`${GEMINI}/models/${m}:predictLongRunning`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instances: [instance], parameters: params })
      })
      if (r.ok) {
        veoModelCache = m
        opName = ((await r.json()) as { name?: string }).name ?? null
        break
      }
      lastErr = `${m} → ${r.status} ${(await r.text()).slice(0, 140)}`
      if (r.status === 404) break // modèle inconnu, inutile de retenter sans durée
    }
    if (opName) break
  }
  if (!opName) throw new Error(`Veo indisponible (${lastErr})`)

  const t0 = Date.now()
  for (;;) {
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('Veo : délai dépassé')
    await new Promise((r) => setTimeout(r, 10000))
    const r = await fetch(`${GEMINI}/${opName}`, { headers: { 'x-goog-api-key': key } })
    if (!r.ok) throw new Error(`Veo suivi ${r.status}`)
    const j = (await r.json()) as {
      done?: boolean
      error?: { message?: string }
      response?: {
        generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] }
        generatedVideos?: { video?: { uri?: string } }[]
      }
    }
    if (j.error) throw new Error(`Veo : ${j.error.message ?? 'erreur'}`)
    if (!j.done) continue
    const uri =
      j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
      j.response?.generatedVideos?.[0]?.video?.uri
    if (!uri) throw new Error('Veo : réponse sans vidéo')
    let dl = await fetch(uri, { headers: { 'x-goog-api-key': key } })
    if (dl.status === 401 || dl.status === 403) {
      dl = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`)
    }
    if (!dl.ok) throw new Error(`Veo téléchargement ${dl.status}`)
    await writeFile(dest, Buffer.from(await dl.arrayBuffer()))
    return
  }
}

/** Durée d'un média en secondes (ffprobe). */
async function mediaDuration(ffprobe: string, file: string): Promise<number> {
  const out = await runCapture(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file
  ])
  const d = parseFloat(out.trim())
  return Number.isFinite(d) && d > 0 ? d : 3
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}
function assEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim()
}
/** Sous-titre plein écran (bas) pour une scène, brûlé via le filtre subtitles. */
function sceneAss(text: string, durationSec: number): string {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Def,Liberation Sans,76,&H00FFFFFF,&H00000000,&H96000000,1,0,1,6,3,2,90,90,430
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${assTime(durationSec)},Def,,0,0,0,,${assEscape(text)}`
}

/**
 * Génère la vidéo complète à partir d'une idée. Renvoie le chemin du MP4 final
 * (dans le dossier des clips, donc servi et publiable) + sa durée.
 */
export async function generateVideoFromIdea(
  ctx: PipelineContext,
  opts: VideoGenOptions
): Promise<{ filePath: string; durationSec: number; usage: Usage | null }> {
  const voice = opts.voice || 'onyx'
  const log = opts.onProgress
  log?.('Écriture du storyboard (IA)…')
  const { scenes, cast, usage } = await buildStoryboard(
    opts.anthropicKey,
    opts.anthropicModel || 'claude-haiku-4-5',
    opts.idea,
    opts.imageStyle,
    opts.dialogue
  )
  if (!scenes.length) throw new Error('Storyboard vide — réessaie')
  const castMap = new Map(cast.map((c) => [c.name.trim().toLowerCase(), c]))

  const stamp = Date.now()
  const work = join(ctx.dirs.downloads, `idea-${stamp}`)
  await mkdir(work, { recursive: true })
  const sceneFiles: string[] = []
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i]
      const member = sc.speaker ? castMap.get(sc.speaker.trim().toLowerCase()) : undefined
      const subText = opts.dialogue && sc.speaker ? `${sc.speaker} : ${sc.narration}` : sc.narration
      const scene = join(work, `scene${i}.mp4`)
      const ass = join(work, `s${i}.ass`)

      // 1) Image de la scène (Nano Banana + planche de référence si dispo).
      log?.(`Scène ${i + 1}/${scenes.length} — image IA…`)
      const png = join(work, `i${i}.png`)
      const imgPrompt = opts.imageStyle
        ? `${sc.imagePrompt}. ${opts.dialogue
            ? `Recurring characters and consistent art style across the whole series (keep them IDENTICAL in every image): ${opts.imageStyle}`
            : `Consistent visual style across the whole video — match this style EXACTLY in every image: ${opts.imageStyle}`}`
        : sc.imagePrompt
      if (opts.geminiKey && opts.characterRefPath) {
        const gPrompt = `Using EXACTLY the characters and art style from the reference image (same faces, colors, outfits, designs), create this new scene: ${sc.imagePrompt}. Vertical 9:16 composition, vivid saturated colors, expressive, dynamic, no text, no watermark.`
        try {
          await genImageGemini(opts.geminiKey, gPrompt, png, opts.characterRefPath)
        } catch {
          await genImage(opts.openaiKey, imgPrompt, png, log, !!opts.imageStyle) // repli si Gemini indisponible
        }
      } else {
        await genImage(opts.openaiKey, imgPrompt, png, log, !!opts.imageStyle)
      }

      // 2a) Moteur VEO : scène PARLÉE — le personnage prononce sa réplique
      // (voix native jouée + vraie synchro labiale + bruitages d'ambiance).
      let sceneDone = false
      if (opts.animateScenes && opts.videoEngine === 'veo' && opts.geminiKey) {
        log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Veo)…`)
        try {
          const clip = join(work, `v${i}.mp4`)
          const words = sc.narration.trim().split(/\s+/).length
          const veoDur: 4 | 6 | 8 = words <= 6 ? 4 : words <= 12 ? 6 : 8
          const who = member?.name ?? sc.speaker ?? 'the main character'
          const style = member?.style ? ` (${member.style})` : ''
          await genVideoVeoTalking(
            opts.geminiKey,
            `${sc.imagePrompt}. The character "${who}" speaks in French with an expressive cartoon voice${style}, saying EXACTLY: « ${sc.narration} ». Accurate lip-sync while talking, expressive face and hand gestures, other characters react, keep the characters and art style strictly identical to the first frame, vivid colors, no text, no captions.`,
            clip,
            png,
            veoDur
          )
          const clipDur = await mediaDuration(ctx.bin.ffprobe, clip)
          await writeFile(ass, sceneAss(subText, clipDur))
          await run(ctx.bin.ffmpeg, [
            '-y', '-loglevel', 'error',
            '-i', clip,
            '-filter_complex',
            `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,subtitles=${ass}[v]`,
            '-map', '[v]', '-map', '0:a?',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
            scene
          ])
          sceneFiles.push(scene)
          sceneDone = true
        } catch (e) {
          log?.(`Scène ${i + 1}/${scenes.length} — Veo indisponible (${e instanceof Error ? e.message : String(e)}) → voix TTS + animation`)
        }
      }
      if (sceneDone) continue

      // 2b) Chemin classique : voix TTS (jouée par personnage) puis animation fal.ai / Ken Burns.
      const sceneVoice = member && OPENAI_VOICES.includes(member.voice) ? member.voice : voice
      log?.(`Scène ${i + 1}/${scenes.length} — voix${member ? ` de ${member.name}` : ' off'}…`)
      const mp3 = join(work, `a${i}.mp3`)
      await tts(opts.openaiKey, sceneVoice, sc.narration, mp3, member ? `${member.name} — ${member.style}` : undefined)
      const dur = (await mediaDuration(ctx.bin.ffprobe, mp3)) + 0.4

      let animClip: string | null = null
      if (opts.animateScenes && opts.falKey) {
        log?.(`Scène ${i + 1}/${scenes.length} — animation vidéo (fal.ai)…`)
        try {
          animClip = join(work, `v${i}.mp4`)
          const talking = sc.speaker
            ? ` The character "${sc.speaker}" is TALKING: clear mouth movement, expressive face and hand gestures while speaking.`
            : ''
          await genVideoFal(
            opts.falKey,
            `Animate this exact scene keeping the characters and art style strictly identical: ${sc.imagePrompt}.${talking} Natural lively character motion, smooth cinematic camera movement, vivid colors, no text.`,
            animClip,
            png,
            opts.falVideoModel || FAL_DEFAULT_MODEL,
            dur > 6.5 ? '10' : '5' // réplique longue → clip plus long (évite l'étirement excessif)
          )
        } catch (e) {
          animClip = null
          log?.(`Scène ${i + 1}/${scenes.length} — fal.ai indisponible (${e instanceof Error ? e.message : String(e)}) → image animée`)
        }
      }

      log?.(`Scène ${i + 1}/${scenes.length} — montage…`)
      await writeFile(ass, sceneAss(subText, dur))
      if (animClip) {
        // Clip animé : recadré 1080x1920 et ÉTIRÉ/COMPRESSÉ en douceur (setpts)
        // pour couvrir exactement la durée de la voix — plus aucun gel d'image.
        const clipDur = await mediaDuration(ctx.bin.ffprobe, animClip)
        const ratio = Math.max(0.5, Math.min(2.5, dur / Math.max(0.5, clipDur)))
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-i', animClip,
          '-i', mp3,
          '-filter_complex',
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts=${ratio.toFixed(4)}*PTS,fps=30,setsar=1,subtitles=${ass}[v]`,
          '-map', '[v]', '-map', '1:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          '-t', String(dur),
          scene
        ])
      } else {
        const frames = Math.max(1, Math.round(dur * 30))
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-loop', '1',
          '-i', png,
          '-i', mp3,
          '-filter_complex',
          `[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,zoompan=z='min(zoom+0.0004,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1,subtitles=${ass}[v]`,
          '-map', '[v]', '-map', '1:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          '-t', String(dur),
          scene
        ])
      }
      sceneFiles.push(scene)
    }

    log?.('Assemblage final…')
    const list = join(work, 'list.txt')
    await writeFile(list, sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
    const concatPath = join(work, 'concat.mp4')
    await run(ctx.bin.ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', concatPath])

    await mkdir(ctx.dirs.clips, { recursive: true })
    const finalPath = join(ctx.dirs.clips, `idea-${stamp}.mp4`)
    const total = await mediaDuration(ctx.bin.ffprobe, concatPath)

    if (opts.musicTrack) {
      log?.('Ajout de la musique de fond…')
      const fadeSt = Math.max(0, total - 2)
      // Ducking (sidechaincompress) : la musique est bien présente (0.55) mais
      // s'abaisse automatiquement dès que la voix parle → voix toujours nette,
      // musique pleine dans les silences. Limiteur pour éviter la saturation.
      await run(ctx.bin.ffmpeg, [
        '-y', '-loglevel', 'error',
        '-i', concatPath,
        '-stream_loop', '-1', '-i', opts.musicTrack,
        '-filter_complex',
        `[0:a]asplit=2[vk][vm];[1:a]volume=0.55,afade=t=out:st=${fadeSt.toFixed(2)}:d=2[bg];[bg][vk]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[bgd];[vm][bgd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.96[a]`,
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
        '-t', String(total),
        finalPath
      ])
    } else {
      await run(ctx.bin.ffmpeg, ['-y', '-loglevel', 'error', '-i', concatPath, '-c', 'copy', finalPath])
    }
    return { filePath: finalPath, durationSec: total, usage }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
