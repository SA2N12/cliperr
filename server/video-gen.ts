import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { writeFile, readFile, mkdir, rm, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { run, runCapture, type PipelineContext } from '../src/main/pipeline/context'
import type { Usage } from '../src/main/pipeline/highlights'
import type { ViralIdea } from '../src/shared/types'
import { veoAvailableModels, noteVeoUse, markVeoExhausted } from './veo-quota'

// Génération d'une vidéo « faceless » 9:16 à partir d'une idée :
// storyboard (Claude) → voix off (OpenAI TTS) + image IA par scène (DALL·E) →
// montage ffmpeg (Ken Burns + sous-titres incrustés) → MP4 vertical.

const OPENAI = 'https://api.openai.com/v1'

const SceneSchema = z.object({ narration: z.string(), imagePrompt: z.string(), speaker: z.string().optional() })
const CastSchema = z.object({ name: z.string(), voice: z.string(), style: z.string(), voiceSignature: z.string().optional() })
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
  /** Signature vocale acoustique et DISTINCTE, réutilisée à l'identique à chaque
   *  scène pour garder la même voix (crucial pour Veo, qui réinvente sinon une voix par clip). */
  voiceSignature?: string
}
/** Voix disponibles côté OpenAI TTS (gpt-4o-mini-tts). */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']

export interface VideoGenOptions {
  anthropicKey: string
  anthropicModel?: string
  openaiKey: string
  voice?: string
  /** Fournisseur de voix off : 'elevenlabs' (voix humaines) sinon OpenAI TTS. */
  voiceProvider?: string
  /** Clé ElevenLabs (si voiceProvider = 'elevenlabs'). */
  elevenKey?: string | null
  idea: ViralIdea
  /** Chemin d'une musique de fond (libre de droits) à mixer sous la voix. */
  musicTrack?: string
  /** Univers visuel imposé (mode série) : personnages récurrents + style, injecté dans chaque image. */
  imageStyle?: string
  /** Clé Gemini (Nano Banana) : images de série avec personnages RÉELLEMENT cohérents. */
  geminiKey?: string | null
  /** Planche de référence des personnages (png) — utilisée par Nano Banana à chaque scène. */
  characterRefPath?: string
  /** La référence est une PHOTO DE PRODUIT, pas une planche de personnages. Le
   *  contrat change du tout au tout : on veut l'objet reproduit à l'identique
   *  dans une scène nouvelle, sans qu'il soit redessiné ni « amélioré ». */
  productRef?: { name: string }
  /** Clé fal.ai : anime chaque scène (image → clip vidéo) au lieu du zoom Ken Burns. */
  falKey?: string | null
  /** Modèle fal.ai (image-to-video) — défaut Seedance lite. */
  falVideoModel?: string
  /** Modèle fal.ai de synchronisation labiale (cale la bouche sur la voix TTS). */
  falLipsyncModel?: string
  /** Clé DeepInfra : Veo payé à la seconde, SANS quota journalier — repli des
   *  scènes parlées quand le quota gratuit Google est épuisé. */
  deepinfraKey?: string | null
  /** Clé Groq : repli pour le calage mot à mot des sous-titres (Whisper). */
  groqKey?: string | null
  /** Débit de parole (0.7–1.2, défaut 1.15). Réglage `speech_speed`. */
  speechSpeed?: number
  /** Moteur PAYANT autorisé une fois le quota Veo gratuit épuisé : 'wan' (~0,50 $
   *  /scène, NOS voix + lip-sync), 'seedance' (~0,84 $) ou 'veo' (~1,20 $).
   *  Absent = repli économique Pixverse (~0,22 $, sans lip-sync). */
  paidEngine?: 'wan' | 'seedance' | 'veo'
  /** Synchro labiale p-video (0,02 $/s) calée sur nos voix, à la place de
   *  l'animation muette. Nécessite `publishPublic` (le modèle exige des URL). */
  prunaLipsync?: boolean
  /** Autoriser Seedance pour les scènes parlées EN. OFF : il ignore l'image de la
   *  scène et réinvente les personnages (réglage `seedance_talking`). */
  seedanceTalking?: boolean
  /** Publie un fichier local sur une URL publique éphémère (+ nettoyage). */
  publishPublic?: (localPath: string) => Promise<{ url: string; cleanup: () => Promise<void> } | null>
  /** Plafond de scènes d'une reproduction (défaut 8, borné 4-24). */
  reproMaxScenes?: number
  /** Style des sous-titres incrustés. Absent = défauts historiques. */
  subStyle?: SubStyle
  /** Langue des dialogues/voix : 'fr' (défaut) ou 'en'. En anglais, les voix
   *  natives des modèles (Veo, Seedance) sonnent parfaitement — et Seedance
   *  (moins cher que Veo) devient utilisable comme moteur de scènes parlées. */
  lang?: 'fr' | 'en'
  /** Active l'animation vidéo des scènes (mode série). */
  animateScenes?: boolean
  /** Mode dialogue : les personnages parlent (voix + intonation par personnage), pas de narrateur. */
  dialogue?: boolean
  /** Incruster les sous-titres (défaut : oui). Off pour une repro dialoguée : les
   *  personnages parlent déjà, un sous-titre « Nom : réplique » fait scénario. */
  burnSubtitles?: boolean
  /** Source MUETTE : aucune voix (ni Veo parlé, ni TTS) — visuels + sous-titres. */
  mute?: boolean
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
  dialogue?: boolean,
  /** `undefined` = AUCUN plafond : une scène par étape de la source (fidélité
   *  maximale). Un nombre force le regroupement (réglage `repro_max_scenes`). */
  reproMax?: number,
  lang: 'fr' | 'en' = 'fr',
  /** Nom du produit ⇒ on écrit une PUBLICITÉ, pas un explicatif. Une pub et une
   *  vidéo de niche ne partagent ni le rythme, ni la valeur des plans, ni le
   *  rôle du sujet : le même storyboard donnerait deux fois la même vidéo. */
  promo?: string
): Promise<{ scenes: Scene[]; cast: CastMember[]; usage: Usage | null }> {
  // Mode anglais (reproductions) : les répliques/voix off sont écrites en anglais
  // natif — la source (souvent française) est TRADUITE fidèlement.
  const enBlock =
    lang === 'en'
      ? '\n⚠️ LANGUE : écris TOUTES les répliques / phrases de voix off en ANGLAIS naturel et natif (traduis fidèlement la source si elle est dans une autre langue — même sens, même ton, même chute). Tout le reste des consignes s\'applique tel quel.\n'
      : ''
  const client = new Anthropic({ apiKey: key, maxRetries: 5 })
  const sceneProps: Record<string, unknown> = {
    narration: {
      type: 'string',
      description: dialogue
        ? 'La RÉPLIQUE du personnage en français : courte (2 à 14 mots), très orale et expressive (interjections, exclamations). L\'histoire doit se comprendre uniquement par les répliques.'
        : promo
          ? 'Une phrase de voix off en français : TRÈS courte (≤ 12 mots), orale, affirmative, tutoiement. La 1re nomme le problème par une image, jamais le produit. AUCUNE ne récite le prix ni n\'appelle à cliquer : le prix et le lien vivent dans la légende.'
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
          style: { type: 'string', description: 'Comment il parle, en français : timbre, débit, émotion, tics de langage (ex. « voix grave et lente, très bête, rit à la fin de ses phrases »)' },
          voiceSignature: { type: 'string', description: 'Signature VOCALE physique et DISTINCTE des autres personnages, en anglais : hauteur (deep/high-pitched), genre, âge, timbre, tempo, texture, accent. Elle sera reprise MOT POUR MOT à chaque scène pour garder EXACTEMENT la même voix. Ex : « a deep, low-pitched, gravelly adult male voice, slow measured tempo, warm raspy timbre, French accent ».' }
        },
        required: ['name', 'voice', 'style', 'voiceSignature']
      }
    }
  }
  const tool = {
    name: 'storyboard',
    description: 'Découpe une idée de vidéo TikTok en scènes (voix + visuel).',
    input_schema: { type: 'object', properties, required: dialogue ? ['cast', 'scenes'] : ['scenes'] }
  } as Anthropic.Tool

  // Mode reproduction fidèle (inspiration) : on suit la source PAS À PAS, sans le
  // template « niche » (hook choc / boucle / CTA) qui la dénaturerait. Peut être en
  // narration (une voix off) OU en dialogue (voix par personnage) selon la source.
  const reproduce = !!idea.reproduce
  // Plus de plafond « produit » : par défaut on suit la source RÉPLIQUE PAR
  // RÉPLIQUE (fidélité maximale — le regroupement faisait perdre des deux tiers
  // du dialogue). Le 60 restant n'est qu'un garde-fou TECHNIQUE : au-delà, le
  // tool-call dépasserait max_tokens et reviendrait tronqué (storyboard vide).
  const REPRO_MAX = Math.max(4, Math.min(60, reproMax ?? ((idea.script ?? []).length || 8)))
  const steps = (idea.script ?? []).slice(0, REPRO_MAX)
  const grouped = (idea.script ?? []).length > REPRO_MAX
  const reproducePrompt = `Tu es monteur TikTok. On REPRODUIT FIDÈLEMENT une vidéo existante : garde son déroulé, son ordre, sa chute et son style. Ne la transforme PAS en vidéo « à la TikTok » (pas de hook choc réinventé, pas de boucle forcée, aucun CTA commentaire/partage si la source n'en a pas).
Titre : ${idea.title}
Hook (scène 1, à garder) : ${idea.hook}
Déroulé à reproduire, DANS L'ORDRE EXACT :
${(idea.script ?? []).map((step, i) => `${i + 1}. ${step}`).join('\n')}

Règles :
- Produis ${grouped ? `AU PLUS ${REPRO_MAX}` : `EXACTEMENT ${steps.length}`} scène(s), dans le même ordre que le déroulé.${grouped ? ` Le déroulé compte ${(idea.script ?? []).length} étapes : REGROUPE les étapes proches en ${REPRO_MAX} scènes pour couvrir toute l'histoire (début → chute) sans rien perdre d'essentiel.` : ' Une par étape ; ne fusionne pas, ne supprime pas, n\'ajoute pas d\'étape.'}
- La VOIX OFF de chaque scène = l'étape correspondante, en français oral fluide (nombres en toutes lettres, phrases courtes). Reste FIDÈLE au contenu ; ne remplace pas la fin par une question ou un CTA générique.
${styleHint ? `- STYLE VISUEL IMPOSÉ (celui de la source, à respecter À L'IDENTIQUE d'une scène à l'autre) : ${styleHint}` : "- Garde un style visuel cohérent et proche de la source d'une scène à l'autre."}
- RÈGLES IMAGE (le générateur refuse sinon) : aucun ENFANT/mineur, aucune personne réelle identifiable, pas de gore ni de contenu sexuel → illustre autrement (objet seul, décor, main d'adulte, document, symbole).

${enBlock}Pour chaque scène : la phrase de VOIX OFF (${lang === 'en' ? 'ANGLAIS' : 'français'}) + un IMAGE PROMPT en anglais respectant ${styleHint ? 'STRICTEMENT le style imposé ci-dessus' : 'le style de la source'}, très détaillé, sans aucun texte. Chaque IMAGE PROMPT décrit SON PROPRE DÉCOR (lieu, arrière-plan, cadrage) : le style est commun à toutes les scènes, PAS le décor — fais-le évoluer au fil de l'histoire au lieu de répéter le même fond. Réponds uniquement via l'outil storyboard.`

  // Reproduction d'une saynète : une RÉPLIQUE par scène + un casting vocal (voix
  // par personnage), au lieu d'une voix off unique.
  const reproduceDialoguePrompt = `Tu es monteur TikTok. On REPRODUIT FIDÈLEMENT une saynète existante (un échange entre plusieurs personnages) : garde ses répliques, leur ordre, sa chute et son style. Ne la transforme PAS en vidéo « à la TikTok » (pas de hook réinventé, pas de CTA ajouté).
Titre : ${idea.title}
Répliques de la source, DANS L'ORDRE EXACT (souvent préfixées du nom du personnage) :
${(idea.script ?? []).map((step, i) => `${i + 1}. ${step}`).join('\n')}

Règles :
- Produis ${grouped ? `AU PLUS ${REPRO_MAX}` : `EXACTEMENT ${steps.length}`} scène(s) : UNE réplique par scène, dans l'ordre.${grouped ? ` La source compte ${(idea.script ?? []).length} répliques : garde les ${REPRO_MAX} qui portent l'histoire du début à la chute, sans en perdre le sens.` : ''}
- Chaque scène a un champ speaker = le personnage qui parle, ÉCRIT EXACTEMENT comme son « name » dans le casting (orthographe IDENTIQUE d'une scène à l'autre, aucune variante ni surnom) — sinon sa voix changera en cours de vidéo.
- CASTING (champ cast) : un membre par personnage récurrent, avec (a) une voix TTS DISTINCTE et adaptée (père/homme = voix grave type onyx/echo ; mère/femme = coral/nova/sage ; enfant/ado = voix claire type shimmer/fable), (b) son intonation (style), et (c) une voiceSignature acoustique précise et DISTINCTE de celle des autres, qui sera répétée à l'identique à CHAQUE scène pour que sa voix ne change JAMAIS.
- Reste FIDÈLE aux répliques et à la chute ; français oral fluide (nombres en toutes lettres).
${styleHint ? `- STYLE VISUEL IMPOSÉ (celui de la source, à l'identique d'une scène à l'autre) : ${styleHint}` : "- Style visuel cohérent et proche de la source d'une scène à l'autre."}
- RÈGLES IMAGE (le générateur refuse sinon) : le personnage qui parle au premier plan, expressif, mais AUCUN enfant/mineur ni personne réelle identifiable de façon photoréaliste → rends-le en style illustré/stylisé (celui de la source) ou de façon générique. Pas de gore ni de contenu sexuel.

${enBlock}Pour chaque scène : la RÉPLIQUE (speaker + narration en ${lang === 'en' ? 'ANGLAIS' : 'français'}) + un IMAGE PROMPT en anglais respectant ${styleHint ? 'STRICTEMENT le style imposé ci-dessus' : 'le style de la source'}, très détaillé, sans aucun texte. Chaque IMAGE PROMPT décrit SON PROPRE DÉCOR (lieu, arrière-plan, cadrage) : le style est commun à toutes les scènes, PAS le décor — fais-le évoluer au fil de l'histoire au lieu de répéter le même fond. Réponds uniquement via l'outil storyboard.`

  // Publicité produit. Le template « niche » (hook choc, plans illustratifs de
  // même valeur, CTA final récité) donne une vidéo qui EXPLIQUE le produit. Une
  // pub le fait DÉSIRER : coupe rapide, objet en action, bascule montrée.
  const promoPrompt = `Tu écris une PUBLICITÉ TikTok pour un produit RÉEL. Ce n'est pas une vidéo explicative : le spectateur doit avoir envie de l'objet, pas apprendre quelque chose.
Produit : ${promo}
Titre : ${idea.title}
Hook : ${idea.hook}
${(idea as { angle?: string }).angle ? `Angle de vente à tenir d'un bout à l'autre : ${(idea as { angle?: string }).angle}` : ''}
Déroulé voulu :
${(idea.script ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

GRAMMAIRE PUBLICITAIRE — c'est elle qui distingue une pub d'un explicatif :
- 6 à 8 scènes COURTES (2 à 3 s chacune), 16 à 22 s au total. La coupe rapide EST le format.
- Scène 1 : un ÉTAT visible, cadré serré, qui agace ou fait envie. Aucune introduction, aucune annonce de ce qui va suivre.
- Le PRODUIT est visible dans au moins deux scènes sur trois, et toujours EN TRAIN DE SERVIR — jamais simplement posé.
- Une scène au moins montre la BASCULE : l'instant où le problème disparaît. C'est le plan qui vend, donne-lui l'image la plus nette et la plus lisible.
- VARIE LES VALEURS DE PLAN d'une scène à l'autre : très gros plan sur le geste, plan large sur le résultat, plan à hauteur de main. Un explicatif enchaîne des plans de même valeur ; une pub, jamais.
- Aucun plan décoratif : chaque scène fait avancer la démonstration.
- Ne récite ni le prix ni le lien — ils vivent dans la légende.${enBlock}`

  const prompt = reproduce
    ? (dialogue ? reproduceDialoguePrompt : reproducePrompt)
    : promo
    ? promoPrompt
    : `Tu es un scénariste TikTok expert en RÉTENTION et en viralité. Transforme cette idée en storyboard de 4 à 5 scènes pour une vidéo verticale « faceless » COURTE de 20 à 28 secondes (la brièveté maximise le taux de complétion — le signal n°1 de l'algorithme TikTok pour être re-poussé au-delà du 1er lot de vues).
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
    // 6000 (au lieu de 3000) : un storyboard de 8 scènes avec des image-prompts
    // « très détaillés » dépassait parfois 3000 tokens → tool-call tronqué → JSON
    // invalide → « Storyboard vide ». On laisse de la marge.
    // Assez de marge pour REPRO_MAX scènes détaillées (narration + imagePrompt +
    // casting) sans troncature du tool-call (= storyboard vide). Plafonné à 32k :
    // au-delà, certains modèles refusent la requête.
    max_tokens: Math.min(32000, Math.max(6000, 2000 + REPRO_MAX * 450)),
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
    const client = new Anthropic({ apiKey: key, maxRetries: 5 })
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
// Consignes de JEU pour la voix off — le vrai levier contre l'effet monotone/IA
// (gpt-4o-mini-tts obéit à ces instructions de ton, débit, émotion).
function voiceInstructions(characterStyle?: string, speed?: number): string {
  // gpt-4o-mini-tts n'a pas de paramètre de vitesse : le débit se pilote par la
  // consigne. On la formule en fonction du réglage pour rester cohérent avec
  // ElevenLabs (qui, lui, a un vrai paramètre).
  const pace = clampSpeed(speed) >= 1.1
    ? ' DÉBIT RAPIDE et enlevé, façon TikTok : enchaîne sans traîner, pas de silence inutile entre les phrases.'
    : clampSpeed(speed) <= 0.9
      ? ' Débit posé, prends ton temps.'
      : ''
  if (characterStyle) {
    return `Tu es un doubleur pro de dessin animé, français de France, prononciation native impeccable. Tu INCARNES ce personnage : ${characterStyle}. Joue-le à fond : intonation très expressive et théâtrale, émotions marquées (cris, chuchotements, rires), rythme vivant. Jamais monocorde.${pace}`
  }
  return `Tu es un créateur TikTok français natif (France) qui raconte une histoire à un pote — PAS un lecteur robotique. Mets de l'ÉNERGIE et surtout des VARIATIONS de ton : accélère sur l'action, RALENTIS et baisse la voix sur le suspense/le mystère, remonte en intensité vers la révélation finale. Marque de vraies respirations et micro-pauses aux virgules. Appuie fort sur les mots-clés (dates, chiffres, mots chocs). Ton complice, vivant, légèrement théâtral, avec des inflexions naturelles — surtout JAMAIS plat ni monotone. Prononciation française impeccable : liaisons naturelles, nombres et noms propres bien articulés.${pace}`
}

// ── ElevenLabs : voix off HUMAINES (modèle multilingue v2). Voix repérée par ID. ──
const ELEVEN = 'https://api.elevenlabs.io/v1'
/** Débit de parole. 1 = naturel (trop posé pour TikTok), 1.15 = vif. ElevenLabs
 *  n'accepte QUE 0.7–1.2 (au-delà : 400 invalid_voice_settings). */
const SPEECH_SPEED_MIN = 0.7
const SPEECH_SPEED_MAX = 1.2
export const SPEECH_SPEED_DEFAULT = 1.15
/** Borne la valeur ENVOYÉE À L'API (0.7–1.2). Une cible supérieure est atteinte
 *  ensuite par accélération audio (cf. speedUpBeyondApiLimit). */
const clampSpeed = (s?: number): number =>
  Math.max(SPEECH_SPEED_MIN, Math.min(SPEECH_SPEED_MAX, Number.isFinite(s) ? (s as number) : SPEECH_SPEED_DEFAULT))

async function elevenSpeech(key: string, voiceId: string, text: string, speed?: number): Promise<Buffer> {
  const res = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      // stabilité basse + style = plus d'émotion/variations (moins monotone).
      // `speed` : mesuré 6,92 s à 0.7 contre 3,71 s à 1.2 sur la même phrase.
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: clampSpeed(speed) }
    })
  })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} : ${(await res.text()).slice(0, 200)}`)
  return Buffer.from(await res.arrayBuffer())
}
/** Liste les voix du compte ElevenLabs (pour le sélecteur par compte). */
export async function listElevenVoices(key: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${ELEVEN}/voices`, { headers: { 'xi-api-key': key } })
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status} : ${(await res.text()).slice(0, 160)}`)
  const j = (await res.json()) as { voices?: { voice_id: string; name: string }[] }
  return (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }))
}

/** Voix du compte avec genre + LANGUE (labels ElevenLabs) → casting par personnage.
 *  La langue n'est PAS toujours dans `labels.language` : les voix « premade » la
 *  portent là, mais une voix importée de la Voice Library l'expose plutôt dans son
 *  `locale` (« fr-FR ») ou dans `verified_languages`. On lit les trois dans l'ordre
 *  du plus fiable au moins fiable — sinon ajouter des voix françaises au compte
 *  resterait SANS EFFET, et en silence. */
async function elevenVoicePool(key: string): Promise<{ id: string; name: string; gender: string; lang: string }[]> {
  const res = await fetch(`${ELEVEN}/voices`, { headers: { 'xi-api-key': key } })
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`)
  const j = (await res.json()) as {
    voices?: {
      voice_id: string
      name: string
      labels?: Record<string, string>
      locale?: string
      verified_languages?: { language?: string; locale?: string }[]
    }[]
  }
  return (j.voices ?? []).map((v) => {
    // « fr-FR », « fr_CA » → « fr ». On garde le PREMIER code à deux lettres
    // exploitable : les sources sont rangées de la plus fiable à la moins fiable.
    const lang =
      [
        v.labels?.language,
        v.labels?.locale,
        v.locale,
        ...(v.verified_languages ?? []).flatMap((l) => [l.language, l.locale])
      ]
        .map((c) => (c ?? '').toLowerCase().split(/[-_]/)[0])
        .find((c) => /^[a-z]{2}$/.test(c)) ?? ''
    return { id: v.voice_id, name: v.name, gender: (v.labels?.gender ?? '').toLowerCase(), lang }
  })
}
/** Attribue à CHAQUE personnage une voix ElevenLabs DISTINCTE. Priorité aux voix
 *  FRANÇAISES (label language=fr) : la bibliothèque par défaut ne contient que des
 *  voix anglaises, qui lisent le français avec un fort accent — c'est ça qui rend
 *  le rendu « bizarre », pas ElevenLabs. Genre respecté quand c'est possible. */
function assignElevenVoices(pool: { id: string; name: string; gender: string; lang: string }[], cast: CastMember[], prefLang = 'fr'): Map<string, string> {
  const map = new Map<string, string>()
  if (!pool.length) return map
  const used = new Set<string>()
  const wanted = (m: CastMember): string => {
    const s = `${m.voiceSignature ?? ''} ${m.style ?? ''} ${m.name ?? ''}`.toLowerCase()
    if (/\b(female|woman|girl|mother|m[eè]re|maman|femme|fille|feminine|soprano|high[- ]pitched)\b/.test(s)) return 'female'
    if (/\b(male|man|boy|father|p[eè]re|papa|homme|gar[çc]on|masculine|deep|gravelly|baritone|bass)\b/.test(s)) return 'male'
    return ''
  }
  const free = (p: (v: { id: string; gender: string; lang: string }) => boolean): { id: string } | undefined =>
    pool.find((v) => !used.has(v.id) && p(v))
  for (const m of cast) {
    const want = wanted(m)
    const pick =
      (want ? free((v) => v.lang === prefLang && v.gender === want) : undefined) ??
      free((v) => v.lang === prefLang) ??
      (want ? free((v) => v.gender === want) : undefined) ??
      free(() => true) ??
      pool[0]
    used.add(pick.id)
    map.set(m.name.trim().toLowerCase(), pick.id)
  }
  return map
}

async function openaiSpeech(openaiKey: string, voice: string, text: string, instructions: string, speed?: number): Promise<Buffer> {
  // Voix inconnue (ex. un ID ElevenLabs en repli) → voix OpenAI sûre.
  const v = OPENAI_VOICES.includes(voice) ? voice : 'ash'
  let res = await fetch(`${OPENAI}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: v, input: text, response_format: 'mp3', instructions })
  })
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    res = await fetch(`${OPENAI}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', voice: v, input: text, response_format: 'mp3', speed: clampSpeed(speed) })
    })
  }
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status} : ${(await res.text()).slice(0, 200)}`)
  return Buffer.from(await res.arrayBuffer())
}

export interface VoiceOpts {
  openaiKey: string
  provider?: string
  elevenKey?: string | null
  /** Débit de parole VISÉ. Au-delà de 1.2 (plafond des API), l'audio est accéléré. */
  speed?: number
  /** Exécute ffmpeg (fourni par le pipeline) — requis pour dépasser 1.2. */
  ffmpeg?: (args: string[]) => Promise<unknown>
  onNote?: (m: string) => void
}

/** Génère un court extrait pour ECOUTER une voix (bouton d'aperçu dans les réglages). */
export async function ttsPreview(voice: string, o: VoiceOpts): Promise<Buffer> {
  const sample =
    'En mille neuf cent quarante-cinq, cinq avions décollent… et disparaissent sans laisser la moindre trace. Accident, ou dissimulation ? Dis-moi en commentaire.'
  // L'aperçu doit avoir le MÊME débit que les vidéos, sinon il ne représente rien.
  if (o.provider === 'elevenlabs' && o.elevenKey && voice) return elevenSpeech(o.elevenKey, voice, sample, o.speed)
  return openaiSpeech(o.openaiKey, voice, sample, voiceInstructions(undefined, o.speed), o.speed)
}

async function tts(voice: string, text: string, dest: string, o: VoiceOpts, characterStyle?: string): Promise<void> {
  // ElevenLabs prioritaire si configuré ; repli automatique sur OpenAI (une voix
  // ne doit jamais faire échouer toute la vidéo).
  if (o.provider === 'elevenlabs' && o.elevenKey && voice) {
    try {
      await writeFile(dest, await elevenSpeech(o.elevenKey, voice, text, o.speed))
      await speedUpBeyondApiLimit(dest, o)
      return
    } catch (e) {
      o.onNote?.(`ElevenLabs indisponible (${e instanceof Error ? e.message.split('\n')[0] : e}) → repli voix OpenAI`)
    }
  }
  await writeFile(dest, await openaiSpeech(o.openaiKey, voice, text, voiceInstructions(characterStyle, o.speed), o.speed))
  await speedUpBeyondApiLimit(dest, o)
}

/** Les API de voix plafonnent à 1.2 ; au-delà, on accélère l'audio (atempo, qui
 *  CONSERVE la hauteur de voix — pas d'effet « chipmunk »). Le lip-sync p-video
 *  se cale ensuite sur ce fichier accéléré, donc tout reste synchrone. */
async function speedUpBeyondApiLimit(dest: string, o: VoiceOpts): Promise<void> {
  const target = Number.isFinite(o.speed) ? (o.speed as number) : SPEECH_SPEED_DEFAULT
  const extra = target / SPEECH_SPEED_MAX
  if (!o.ffmpeg || extra <= 1.01) return
  const tmp = `${dest}.fast.mp3`
  try {
    await o.ffmpeg(['-y', '-loglevel', 'error', '-i', dest, '-filter:a', `atempo=${Math.min(2, extra).toFixed(3)}`, tmp])
    await copyFile(tmp, dest)
    await rm(tmp, { force: true })
  } catch (e) {
    o.onNote?.(`accélération audio impossible (${e instanceof Error ? e.message.split('\n')[0] : e}) — débit natif conservé`)
  }
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
export async function genImage(openaiKey: string, prompt: string, dest: string, onNote?: (m: string) => void, keepStyle = false): Promise<void> {
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

// ── DeepInfra : images. DEUX modèles selon le besoin (validés en réel) :
//  • avec planche de référence → `Qwen-Image-Edit` (0,028 $) : reprend fidèlement
//    le personnage et le style — tient le rôle de Nano Banana ;
//  • sans référence → `FLUX-2-klein-9b` (0,013 $) : qualité 3D/Pixar excellente.
// (Seedream 4/4.5 renvoient « request_info init exception » chez DeepInfra, et
//  FLUX IGNORE l'image de référence → ne jamais l'utiliser pour la cohérence.) ──
export const DI_IMAGE_REF_MODEL = 'Qwen/Qwen-Image-Edit'
export const DI_IMAGE_MODEL = 'black-forest-labs/FLUX-2-klein-9b'
export async function genImageDeepinfra(
  key: string,
  prompt: string,
  dest: string,
  refPath?: string,
  model?: string
): Promise<void> {
  const body: Record<string, unknown> = { prompt }
  if (refPath) body.image = `data:image/png;base64,${(await readFile(refPath)).toString('base64')}`
  else {
    body.width = 720
    body.height = 1280
  }
  model = model || (refPath ? DI_IMAGE_REF_MODEL : DI_IMAGE_MODEL)
  const r = await fetch(`${DEEPINFRA}/v1/inference/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`DeepInfra image ${r.status} : ${(await r.text()).slice(0, 160)}`)
  const j = (await r.json()) as { images?: string[]; image?: string }
  const img = j.images?.[0] ?? j.image
  if (!img) throw new Error('DeepInfra image : réponse vide')
  if (img.startsWith('data:') || !img.startsWith('http')) {
    const b64 = img.includes(',') ? img.slice(img.indexOf(',') + 1) : img
    await writeFile(dest, Buffer.from(b64, 'base64'))
    return
  }
  const dl = await fetch(img)
  if (!dl.ok) throw new Error(`DeepInfra image téléchargement ${dl.status}`)
  await writeFile(dest, Buffer.from(await dl.arrayBuffer()))
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

// ── fal.ai : synchronisation labiale (lip-sync) ──
// Cale la BOUCHE d'un clip vidéo sur une piste audio (la voix TTS du personnage).
// Combiné à une voix TTS FIXE par personnage → voix constante d'un bout à l'autre
// ET lèvres synchronisées, sans dépendre de Veo. Changeable via `fal_lipsync_model`.
export const FAL_LIPSYNC_MODEL = 'fal-ai/sync-lipsync'
async function genLipsyncFal(
  falKey: string,
  videoPath: string,
  audioPath: string,
  dest: string,
  model: string = FAL_LIPSYNC_MODEL
): Promise<void> {
  const auth = { Authorization: `Key ${falKey}` }
  const videoB64 = (await readFile(videoPath)).toString('base64')
  const audioB64 = (await readFile(audioPath)).toString('base64')
  const submit = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_url: `data:video/mp4;base64,${videoB64}`,
      audio_url: `data:audio/mpeg;base64,${audioB64}`
    })
  })
  if (!submit.ok) throw new Error(`fal.ai lipsync ${submit.status} : ${(await submit.text()).slice(0, 160)}`)
  const sub = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string }
  if (!sub.request_id) throw new Error('fal.ai lipsync : réponse sans request_id')
  const statusUrl = sub.status_url ?? `${FAL_QUEUE}/${model}/requests/${sub.request_id}/status`
  const resultUrl = sub.response_url ?? `${FAL_QUEUE}/${model}/requests/${sub.request_id}`
  const t0 = Date.now()
  for (;;) {
    if (Date.now() - t0 > 8 * 60 * 1000) throw new Error('fal.ai lipsync : délai dépassé')
    await new Promise((r) => setTimeout(r, 6000))
    const st = await fetch(statusUrl, { headers: auth })
    if (!st.ok) throw new Error(`fal.ai lipsync suivi ${st.status}`)
    const sj = (await st.json()) as { status?: string }
    if (sj.status === 'FAILED' || sj.status === 'ERROR') throw new Error('fal.ai lipsync : génération échouée')
    if (sj.status !== 'COMPLETED') continue
    const rr = await fetch(resultUrl, { headers: auth })
    if (!rr.ok) throw new Error(`fal.ai lipsync résultat ${rr.status}`)
    const j = (await rr.json()) as { video?: { url?: string } }
    const url = j.video?.url
    if (!url) throw new Error('fal.ai lipsync : réponse sans vidéo')
    const dl = await fetch(url)
    if (!dl.ok) throw new Error(`fal.ai lipsync téléchargement ${dl.status}`)
    await writeFile(dest, Buffer.from(await dl.arrayBuffer()))
    return
  }
}

// ── Veo (Gemini) : scène PARLÉE — le personnage prononce sa réplique avec
// voix native + lipsync + bruitages, à partir de l'image de la scène. ──
// Les 3 modèles Veo (fast → full → lite) sont tentés dans l'ordre en sautant ceux
// déjà épuisés aujourd'hui → on cumule leurs quotas journaliers (cf. veo-quota).

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
  const models = veoAvailableModels()
  if (!models.length) throw new Error('Veo : quota journalier épuisé (fast + full + lite)')
  let opName: string | null = null
  let usedModel = ''
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
        usedModel = m
        opName = ((await r.json()) as { name?: string }).name ?? null
        break
      }
      lastErr = `${m} → ${r.status} ${(await r.text()).slice(0, 140)}`
      // 429 = quota du jour épuisé sur CE modèle → on le marque et on passe au
      // suivant (fast → full → lite). 404 = modèle inconnu → suivant aussi.
      if (r.status === 429) {
        markVeoExhausted(m)
        break
      }
      if (r.status === 404) break
    }
    if (opName) break
  }
  if (opName && usedModel) noteVeoUse(usedModel)
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

// ── Veo via DeepInfra : même modèle (veo-3.1-fast), payé à la seconde, SANS
// quota journalier. Appel SYNCHRONE (la réponse arrive quand la vidéo est prête,
// 1 à 4 min) ; l'image de départ passe en Data URL base64 (schéma officiel). ──
const DEEPINFRA = 'https://api.deepinfra.com'
/** Récupère le MP4 d'une réponse DeepInfra. Le champ varie selon le modèle
 *  (`videos` pour Veo, `video_url` pour Pixverse) et peut être une data-URL, une
 *  URL absolue (Google Storage, CDN Pixverse) ou un chemin relatif à l'API.
 *  ⚠️ Ne JAMAIS envoyer la clé DeepInfra à un hôte externe. */
async function saveDeepinfraVideo(key: string, j: Record<string, unknown>, dest: string): Promise<void> {
  const raw = (j.videos ?? j.video_url ?? j.video) as string | string[] | undefined
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v) throw new Error(`DeepInfra : réponse sans vidéo (${JSON.stringify(j).slice(0, 160)})`)
  if (v.startsWith('data:')) {
    await writeFile(dest, Buffer.from(v.slice(v.indexOf(',') + 1), 'base64'))
    return
  }
  const abs = v.startsWith('http')
  const dl = await fetch(abs ? v : `${DEEPINFRA}${v}`, abs ? undefined : { headers: { Authorization: `Bearer ${key}` } })
  if (!dl.ok) throw new Error(`DeepInfra téléchargement ${dl.status}`)
  await writeFile(dest, Buffer.from(await dl.arrayBuffer()))
}
// ── p-video (PrunaAI, via DeepInfra) : anime l'image EN SE CALANT SUR UNE PISTE
// AUDIO fournie → vraie synchro labiale sur NOS voix ElevenLabs (constantes), pour
// 0,02 $/s au lieu de 0,15 $/s (Veo). ⚠️ Le modèle va chercher l'image et l'audio
// LUI-MÊME par URL : il refuse le base64 → d'où les fichiers publics éphémères. ──
// ── Wan 2.7 (Alibaba, via DeepInfra) : LE meilleur rapport qualité/prix pour une
// scène parlée. `first_frame` conserve le personnage à l'identique, et
// `driving_audio` cale le lip-sync sur NOTRE piste vocale — donc nos voix
// ElevenLabs, constantes par personnage, au lieu d'une voix réinventée par le
// modèle. 0,10 $/s (≈ 0,50 $ les 5 s), contre 0,15 $/s pour Veo.
// ⚠️ Les deux entrées exigent des URL : le base64 dépasse leur limite de taille.
export async function genVideoWan27(
  key: string,
  prompt: string,
  dest: string,
  firstFrameUrl: string,
  drivingAudioUrl: string
): Promise<void> {
  const r = await fetch(`${DEEPINFRA}/v1/inference/Wan-AI/Wan2.7-I2V`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      negative_prompt: 'text, subtitles, captions, watermark, logo, timestamp, letters, numbers',
      first_frame: firstFrameUrl,
      // La durée est dictée par l'audio : ne PAS envoyer `duration` (400 sinon).
      driving_audio: drivingAudioUrl,
      resolution: '720P'
    })
  })
  if (!r.ok) throw new Error(`Wan 2.7 ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

export const DI_PRUNA_MODEL = 'PrunaAI/p-video'
export async function genVideoPruna(
  key: string,
  prompt: string,
  dest: string,
  imageUrl: string,
  audioUrl: string,
  model = DI_PRUNA_MODEL
): Promise<void> {
  const r = await fetch(`${DEEPINFRA}/v1/inference/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image: imageUrl,
      audio: audioUrl, // fournir l'audio ⇒ la durée suit la voix (param `duration` ignoré)
      aspect_ratio: '9:16',
      resolution: '720p'
    })
  })
  if (!r.ok) throw new Error(`p-video ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

// ── Seedance 1.5 Pro (ByteDance, via DeepInfra) : scènes PARLÉES avec voix
// natives + lip-sync, nettement moins cher que Veo. ⚠️ ANGLAIS uniquement :
// testé 2× en français → répliques massacrées (« Papa Pop eline mi regard pas »).
// Réservé au mode `lang: 'en'`. ──
export async function genVideoSeedanceTalking(
  key: string,
  prompt: string,
  dest: string,
  refImagePath: string,
  durationSec: number,
  /** `false` : clip MUET (on posera notre propre voix) — permet d'utiliser sa
   *  qualité d'image même en français, langue qu'il ne sait pas prononcer. */
  withAudio = true
): Promise<void> {
  const r = await fetch(`${DEEPINFRA}/v1/inference/ByteDance/Seedance-1.5-Pro`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image: `data:image/png;base64,${(await readFile(refImagePath)).toString('base64')}`,
      duration: Math.max(4, Math.min(12, Math.round(durationSec))),
      aspect_ratio: '9:16',
      generate_audio: withAudio
    })
  })
  if (!r.ok) throw new Error(`Seedance ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

// ── Seedance 2.0 (ByteDance, via DeepInfra) : scène PARLÉE avec voix native,
// lip-sync et personnage FIDÈLE. ⚠️ Le paramètre `image` est IGNORÉ par ce modèle
// (comme en 1.5) — la fidélité passe par `reference_images`, qui exige des URL
// publiques. Vérifié : réplique française respectée quasi au mot près, personnage
// et décor identiques à la référence. ~0,84 $ les 5 s. ──
export async function genVideoSeedance2(
  key: string,
  prompt: string,
  dest: string,
  refImageUrl: string,
  durationSec: number
): Promise<void> {
  const r = await fetch(`${DEEPINFRA}/v1/inference/ByteDance/Seedance-2.0`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      reference_images: [refImageUrl],
      duration: Math.max(4, Math.min(15, Math.round(durationSec))),
      aspect_ratio: '9:16'
    })
  })
  if (!r.ok) throw new Error(`Seedance 2.0 ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

export async function genVideoVeoDeepinfra(
  key: string,
  prompt: string,
  dest: string,
  refImagePath: string
): Promise<void> {
  const imageB64 = (await readFile(refImagePath)).toString('base64')
  const r = await fetch(`${DEEPINFRA}/v1/inference/google/veo-3.1-fast`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image: `data:image/png;base64,${imageB64}`,
      generate_audio: true, // défaut FALSE côté DeepInfra → sans lui, scène muette
      aspect_ratio: '9:16',
      resolution: '720p'
    })
  })
  if (!r.ok) throw new Error(`DeepInfra Veo ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

// ── DeepInfra : animation d'une scène (image → clip vidéo), équivalent fal.ai.
// Muet (`generate_audio_switch` off) : la voix TTS est mixée au montage. ──
export async function genVideoDeepinfra(
  key: string,
  prompt: string,
  dest: string,
  refImagePath: string,
  durationSec: number,
  model = 'Pixverse/Pixverse-6-I2V',
  /** Source muette : on demande les BRUITS D'AMBIANCE (pas de voix) au modèle. */
  withAmbientAudio = false
): Promise<void> {
  const r = await fetch(`${DEEPINFRA}/v1/inference/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image: `data:image/png;base64,${(await readFile(refImagePath)).toString('base64')}`,
      quality: '720p',
      // Le modèle incruste sinon des sous-titres/filigranes/horodatages inventés.
      negative_prompt: 'text, subtitles, captions, watermark, logo, timestamp, letters, numbers, on-screen writing',
      duration: Math.max(1, Math.min(15, Math.round(durationSec))),
      ...(withAmbientAudio ? { generate_audio_switch: true } : {})
    })
  })
  if (!r.ok) throw new Error(`DeepInfra vidéo ${r.status} : ${(await r.text()).slice(0, 160)}`)
  await saveDeepinfraVideo(key, (await r.json()) as Record<string, unknown>, dest)
}

/** Le fichier contient-il une piste audio ? (clip d'animation avec ambiance ou non) */
async function hasAudioStream(ffprobe: string, file: string): Promise<boolean> {
  try {
    const out = await runCapture(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file])
    return out.trim().length > 0
  } catch {
    return false
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
/** Timings MOT À MOT RÉELS de la parole (Whisper) → sous-titres parfaitement calés.
 *  Sans ça, on ne peut que répartir les mots au prorata de leur longueur : le
 *  décalage est perceptible dès qu'il y a une pause ou un changement de débit.
 *  Renvoie `null` si indisponible (l'appelant retombe sur la répartition). */
async function speechWordTimings(
  ctx: PipelineContext,
  mediaPath: string,
  work: string,
  idx: number,
  keys: { deepinfraKey?: string | null; groqKey?: string | null },
  log?: (m: string) => void
): Promise<{ text: string; start: number; end: number }[] | null> {
  const targets: { name: string; url: string; key: string; model: string }[] = []
  if (keys.deepinfraKey) targets.push({ name: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai/audio/transcriptions', key: keys.deepinfraKey, model: 'openai/whisper-large-v3-turbo' })
  if (keys.groqKey) targets.push({ name: 'Groq', url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: keys.groqKey, model: 'whisper-large-v3-turbo' })
  if (!targets.length) return null
  const mp3 = join(work, `sub${idx}.mp3`)
  try {
    await run(ctx.bin.ffmpeg, ['-y', '-loglevel', 'error', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3])
  } catch {
    return null // pas de piste audio (scène muette) → répartition proportionnelle
  }
  const buf = await readFile(mp3).catch(() => null)
  if (!buf) return null
  for (const t of targets) {
    try {
      const form = new FormData()
      form.append('model', t.model)
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'word')
      form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'a.mp3')
      const r = await fetch(t.url, { method: 'POST', headers: { Authorization: `Bearer ${t.key}` }, body: form })
      if (!r.ok) throw new Error(`${t.name} ${r.status}`)
      const j = (await r.json()) as { words?: { word: string; start: number; end: number }[] }
      const raw = (j.words ?? [])
        .map((w) => ({ text: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
        .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
      // Whisper découpe les élisions (« j » + « 'ai ») et isole la ponctuation :
      // affichés seuls, ces fragments clignotent. On les recolle au mot précédent.
      const words: { text: string; start: number; end: number }[] = []
      for (const w of raw) {
        const glue = /^['’]/.test(w.text) || /^[.,!?;:…»)\]]+$/.test(w.text)
        if (glue && words.length) {
          const prev = words[words.length - 1]
          prev.text += w.text.startsWith("'") || w.text.startsWith('’') ? w.text : ` ${w.text}`.trimEnd()
          prev.end = w.end
        } else {
          words.push({ ...w })
        }
      }
      if (words.length) return words
      return null // audio sans parole détectée
    } catch (e) {
      log?.(`Sous-titres : calage ${t.name} indisponible (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return null
}

// ── Sous-titres style TikTok : groupes de 3 MOTS, TOUT EN MAJUSCULES, police
// grasse à contour noir, et le mot en cours de prononciation affiché en JAUNE. ──
/** Style des sous-titres, personnalisable par catégorie. Toute valeur absente
 *  reprend le défaut historique : un réglage vide ne doit rien changer au rendu. */
export type SubStyle = {
  /** Police installée dans l'image (cf. Dockerfile). */
  font?: string
  size?: number
  /** Couleurs en RRGGBB (comme le web) — converties en BBGGRR pour l'ASS. */
  color?: string
  hilite?: string
  outline?: number
  /** Mots affichés ensemble. */
  group?: number
  /** Distance au bas de l'image, en pixels d'une vidéo 1080×1920. */
  bottom?: number
  upper?: boolean
}
export const SUB_DEFAUT: Required<SubStyle> = {
  // Grotesque très grasse, comme les gros comptes TikTok. Autres polices
  // installées : Anton (condensée), Luckiest Guy et Fredoka (cartoon), Inter.
  font: 'Archivo Black',
  size: 86,
  color: 'FFFFFF',
  // Le mot prononcé passe au jaune, le reste du groupe reste blanc.
  hilite: 'FFFF00',
  outline: 6,
  group: 3,
  bottom: 430,
  upper: true
}
/** RRGGBB (web) → BBGGRR (ASS). Inverser les octets est tout ce qui les sépare. */
function assColor(rgb: string): string {
  const h = /^[0-9a-f]{6}$/i.test(rgb) ? rgb : SUB_DEFAUT.color
  return `${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}
/** Complète un style partiel, en écartant les valeurs hors bornes. */
export function subStyle(s?: SubStyle | null): Required<SubStyle> {
  const n = (v: unknown, def: number, min: number, max: number): number => {
    const x = Number(v)
    return Number.isFinite(x) && x >= min && x <= max ? x : def
  }
  return {
    font: (s?.font || '').trim() || SUB_DEFAUT.font,
    size: n(s?.size, SUB_DEFAUT.size, 30, 200),
    color: /^[0-9a-f]{6}$/i.test(s?.color ?? '') ? (s?.color as string) : SUB_DEFAUT.color,
    hilite: /^[0-9a-f]{6}$/i.test(s?.hilite ?? '') ? (s?.hilite as string) : SUB_DEFAUT.hilite,
    outline: n(s?.outline, SUB_DEFAUT.outline, 0, 20),
    group: Math.round(n(s?.group, SUB_DEFAUT.group, 1, 8)),
    bottom: Math.round(n(s?.bottom, SUB_DEFAUT.bottom, 40, 1500)),
    upper: s?.upper ?? SUB_DEFAUT.upper
  }
}

export function sceneAss(
  text: string,
  durationSec: number,
  timed?: { text: string; start: number; end: number }[] | null,
  style?: SubStyle | null
): string {
  const st = subStyle(style)
  const SUB_GROUP = st.group
  const SUB_HILITE = `{\\c&H${assColor(st.hilite)}&}`
  const SUB_NORMAL = `{\\c&H${assColor(st.color)}&}`
  /** Majuscules optionnelles : certains styles (Fredoka, Inter) se lisent mieux
   *  en casse normale, et le forçage cassait les sigles. */
  const casse = (s: string): string => (st.upper ? s.toUpperCase() : s)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Def,${st.font},${st.size},&H00${assColor(st.color)},&H00000000,&H00000000,1,0,1,${st.outline},0,2,90,90,${st.bottom}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  /** Une ligne = le groupe entier ; seul le mot en cours passe en jaune. Le
   *  contour noir du style garde le texte lisible sur n'importe quel fond. */
  const groupLine = (group: string[], active: number, start: number, end: number): string => {
    const txt = group
      .map((w, k) => (k === active ? `${SUB_HILITE}${w}${SUB_NORMAL}` : w))
      .join(' ')
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Def,,0,0,0,,${txt}`
  }

  // Timings RÉELS (Whisper sur l'audio de la scène) : chaque mot se colore
  // exactement quand il est prononcé, et le groupe reste affiché entre-temps.
  if (timed && timed.length) {
    const words = timed.map((w) => ({ ...w, text: casse(assEscape(w.text)) })).filter((w) => w.text)
    const lines: string[] = []
    for (let g = 0; g < words.length; g += SUB_GROUP) {
      const group = words.slice(g, g + SUB_GROUP)
      group.forEach((w, j) => {
        const start = Math.max(0, Math.min(durationSec, w.start))
        // Le mot reste surligné jusqu'au SUIVANT (pas de clignotement entre les
        // mots) ; le dernier du groupe tient jusqu'au groupe d'après.
        const next = words[g + j + 1]
        const rawEnd = next ? next.start : w.end
        const end = Math.max(start + 0.12, Math.min(durationSec, rawEnd))
        lines.push(groupLine(group.map((x) => x.text), j, start, end))
      })
    }
    return lines.length ? `${header}\n${lines.join('\n')}` : header
  }

  // Repli sans timings : répartition proportionnelle à la longueur des mots.
  const words = casse(assEscape(text)).split(/\s+/).filter(Boolean)
  if (!words.length) return header
  const weights = words.map((w) => Math.max(2, w.length))
  const total = weights.reduce((a, b) => a + b, 0)
  const bounds: { start: number; end: number }[] = []
  let t = 0
  words.forEach((_, i) => {
    const end = i === words.length - 1 ? durationSec : t + (durationSec * weights[i]) / total
    bounds.push({ start: t, end })
    t = end
  })
  const lines: string[] = []
  for (let g = 0; g < words.length; g += SUB_GROUP) {
    const group = words.slice(g, g + SUB_GROUP)
    group.forEach((_, j) => {
      const b = bounds[g + j]
      lines.push(groupLine(group, j, b.start, b.end))
    })
  }
  return `${header}\n${lines.join('\n')}`
}

/**
 * Génère la vidéo complète à partir d'une idée. Renvoie le chemin du MP4 final
 * (dans le dossier des clips, donc servi et publiable) + sa durée.
 */
export async function generateVideoFromIdea(
  ctx: PipelineContext,
  opts: VideoGenOptions
): Promise<{ filePath: string; durationSec: number; usage: Usage | null }> {
  const voice = opts.voice || 'ash' // ash = plus expressive/dynamique qu'onyx (par défaut)
  const log = opts.onProgress
  // La langue est tracée : c'est le premier endroit où un mauvais réglage se voit.
  log?.(`Écriture du storyboard (IA) — dialogues en ${opts.lang === 'en' ? 'ANGLAIS' : 'français'}…`)
  const { scenes, cast, usage } = await buildStoryboard(
    opts.anthropicKey,
    opts.anthropicModel || 'claude-haiku-4-5',
    opts.idea,
    opts.imageStyle,
    opts.dialogue,
    opts.reproMaxScenes,
    // ⚠️ SANS ce paramètre, le storyboard reste en FRANÇAIS alors que le reste de
    // la chaîne bascule en anglais : les moteurs anglophones prononcent alors du
    // texte français (accent étranger) et les sous-titres restent en français.
    opts.lang,
    // Une photo de produit en référence ⇒ on tourne une pub, pas un explicatif.
    opts.productRef?.name
  )
  if (!scenes.length) throw new Error('Storyboard vide — réessaie')
  const castMap = new Map(cast.map((c) => [c.name.trim().toLowerCase(), c]))
  // Portrait de référence appris par personnage : sa 1re image réussie sert de
  // modèle à toutes ses scènes suivantes (cf. plus bas), pour qu'il reste le même.
  const speakerRefs = new Map<string, string>()

  // Reproduction dialoguée en ElevenLabs : on répartit des voix HUMAINES distinctes
  // par personnage (naturelles + constantes) au lieu du TTS OpenAI (robotique).
  const elevenMode = opts.voiceProvider === 'elevenlabs' && !!opts.elevenKey
  let elevenCast = new Map<string, string>()
  let elevenFallbackVoice = opts.voice || ''
  if (elevenMode && opts.dialogue && cast.length && opts.elevenKey) {
    try {
      const pool = await elevenVoicePool(opts.elevenKey)
      if (pool.length) {
        const prefLang = opts.lang === 'en' ? 'en' : 'fr'
        if (!elevenFallbackVoice) elevenFallbackVoice = (pool.find((v) => v.lang === prefLang) ?? pool[0]).id
        elevenCast = assignElevenVoices(pool, cast, prefLang)
        // On NOMME la voix retenue pour chaque personnage : c'est la seule façon de
        // voir, dans le journal, qu'un rôle est parti sur une voix d'une autre langue.
        const byId = new Map(pool.map((v) => [v.id, v]))
        log?.(
          `Voix ElevenLabs : ${cast
            .map((c) => {
              const v = byId.get(elevenCast.get(c.name.trim().toLowerCase()) ?? '')
              return `${c.name} → ${v ? `${v.name} [${v.lang || 'langue inconnue'}]` : '?'}`
            })
            .join(' · ')}`
        )
        // Aucune voix dans la langue demandée : le texte SERA lu avec un accent
        // étranger. Ce n'est pas un bug du moteur, c'est la bibliothèque du compte
        // qui est incomplète — on le dit, au lieu de laisser deviner à l'écoute.
        if (!pool.some((v) => v.lang === prefLang)) {
          log?.(
            `⚠ Aucune voix « ${prefLang} » parmi les ${pool.length} voix du compte ElevenLabs — ` +
              `le dialogue sera lu avec un accent étranger. Ajoute des voix ` +
              `${prefLang === 'fr' ? 'françaises' : 'anglaises'} depuis la Voice Library ElevenLabs.`
          )
        }
      }
    } catch (e) {
      log?.(`ElevenLabs : liste des voix indisponible (${e instanceof Error ? e.message : String(e)}) → voix unique du compte`)
    }
  }

  const stamp = Date.now()
  const work = join(ctx.dirs.downloads, `idea-${stamp}`)
  await mkdir(work, { recursive: true })
  const sceneFiles: string[] = []
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i]
      const member = sc.speaker ? castMap.get(sc.speaker.trim().toLowerCase()) : undefined
      // Sous-titre : jamais préfixé du nom du personnage (« Cerise : … » fait
      // script de théâtre) — la réplique seule, et seulement si on les incruste.
      const subText = sc.narration
      const scene = join(work, `scene${i}.mp4`)
      const ass = join(work, `s${i}.ass`)
      const burnSubs = opts.burnSubtitles !== false
      const subFilter = burnSubs ? `,subtitles=${ass}` : ''

      // 1) Image de la scène (Nano Banana + planche de référence si dispo).
      log?.(`Scène ${i + 1}/${scenes.length} — image IA…`)
      const png = join(work, `i${i}.png`)
      // Le style est une consigne de RENDU (technique, palette, lumière, design des
      // persos) — surtout PAS de décor : il est réinjecté à chaque scène, donc un
      // lieu qui s'y serait glissé collerait le même fond à toute la vidéo. On le
      // dit explicitement au modèle (les idées déjà en base peuvent en contenir).
      const styleRule = 'This is a RENDERING STYLE ONLY — ignore any location or setting mentioned in it; the setting of THIS scene is the one described above and must be clearly different from the other scenes.'
      const imgPrompt = opts.imageStyle
        ? `${sc.imagePrompt}. ${opts.dialogue
            ? `Recurring characters and consistent art style across the whole series (keep them IDENTICAL in every image): ${opts.imageStyle}`
            : `Consistent visual style across the whole video — match this style EXACTLY in every image: ${opts.imageStyle}`} ${styleRule}`
        : sc.imagePrompt
      // Chaîne d'images : DeepInfra (Seedream, fournisseur centralisé) → Gemini
      // (Nano Banana) → OpenAI. Chacun sait exploiter la planche de référence pour
      // garder les personnages identiques ; on ne descend d'un cran qu'en cas d'échec.
      // Cohérence des personnages : la planche de la source ne montre pas toujours
      // TOUS les personnages, et chaque scène « réinvente » alors celui qui manque
      // (la même femme est sortie en pêche, puis en fraise, puis en humaine). Dès
      // qu'un personnage a été dessiné une fois, on réutilise CETTE image comme
      // référence pour ses scènes suivantes — il devient sa propre planche.
      const speakerKey = sc.speaker?.trim().toLowerCase() ?? ''
      const learntRef = speakerKey ? speakerRefs.get(speakerKey) : undefined
      const refPath = learntRef ?? opts.characterRefPath
      const hasRef = !!refPath
      // ⚠️ La référence peut être une image RÉELLE de la source (reproduction) :
      // elle porte donc souvent des sous-titres incrustés, un logo ou un pseudo —
      // à ne SURTOUT pas recopier, sinon on hérite du texte de l'original.
      // Contenu promotionnel : la référence est le VRAI produit. Le modèle a une
      // tendance forte à « embellir » un objet — changer sa forme, ajouter un
      // logo, modifier ses couleurs — ce qui donnerait une vidéo montrant autre
      // chose que ce que le client recevra. D'où une consigne d'exactitude bien
      // plus stricte que pour un personnage.
      const refPromptProduit = opts.productRef
        ? `The reference image shows a REAL PRODUCT: ${opts.productRef.name}. Reproduce this EXACT product — identical shape, proportions, colors, materials, markings and details — and place it, in use, into this new scene: ${sc.imagePrompt}. Do NOT redesign, restyle, simplify or "improve" the product in any way. Do NOT add any logo, brand name, text or label that is not on the reference. The product must remain clearly recognizable as the same object a customer would receive. Photorealistic, vertical 9:16 composition, natural lighting, the product in sharp focus. The output must contain NO text of any kind.`
        : ''
      const refPrompt = refPromptProduit || (learntRef
        ? `The reference image shows the SAME CHARACTER as the one speaking in this scene. Reuse them EXACTLY (identical face, head shape, colors, hair, outfit, proportions) and place them in this new scene: ${sc.imagePrompt}. Keep the SAME rendering technique${opts.imageStyle ? `: ${opts.imageStyle}` : ''}. Vertical 9:16, vivid saturated colors, expressive. The output must contain NO text of any kind.`
        : `The reference image is a CONTACT SHEET: a grid of several stills from the same source video, showing its cast and art style. Using EXACTLY these characters (same faces, colors, outfits, designs — pick the ones relevant to this scene), create ONE new single scene (not a grid): ${sc.imagePrompt}. Keep the SAME rendering technique as the reference — do not turn it into a flat 2D illustration${opts.imageStyle ? `: ${opts.imageStyle}` : ''}. Vertical 9:16 composition, vivid saturated colors, expressive, dynamic. IGNORE and REMOVE any text, subtitle, caption, username, logo or watermark visible in the reference image — the output must contain NO text of any kind.`)
      let imgDone = false
      if (opts.deepinfraKey) {
        try {
          await genImageDeepinfra(opts.deepinfraKey, hasRef ? refPrompt : `${imgPrompt}. Vertical 9:16 composition, no text, no watermark.`, png, refPath)
          imgDone = true
        } catch (e) {
          log?.(`Scène ${i + 1}/${scenes.length} — image DeepInfra indisponible (${e instanceof Error ? e.message : String(e)}) → repli`)
        }
      }
      if (!imgDone && opts.geminiKey && hasRef) {
        try {
          await genImageGemini(opts.geminiKey, refPrompt, png, refPath)
          imgDone = true
        } catch {
          /* repli OpenAI ci-dessous */
        }
      }
      if (!imgDone) await genImage(opts.openaiKey, imgPrompt, png, log, !!opts.imageStyle)

      // Première apparition réussie de ce personnage → son portrait devient la
      // référence de toutes ses scènes suivantes.
      if (speakerKey && !speakerRefs.has(speakerKey) && existsSync(png)) speakerRefs.set(speakerKey, png)

      // 2a) Moteur VEO : scène PARLÉE — le personnage prononce sa réplique
      // (voix native jouée + vraie synchro labiale + bruitages d'ambiance).
      // Google (quota gratuit) d'abord, puis DeepInfra (payé/s, sans plafond).
      // Source muette → on saute complètement Veo : il PARLERAIT (voix native) alors
      // que la source est silencieuse, et c'est lui qui incruste le charabia.
      let sceneDone = false
      if (!opts.mute && opts.animateScenes && opts.videoEngine === 'veo' && (opts.geminiKey || opts.deepinfraKey)) {
        const clip = join(work, `v${i}.mp4`)
        const words = sc.narration.trim().split(/\s+/).length
        const veoDur: 4 | 6 | 8 = words <= 6 ? 4 : words <= 12 ? 6 : 8
        const who = member?.name ?? sc.speaker ?? 'the main character'
        // Voix RÉUTILISÉE À L'IDENTIQUE à chaque scène pour ce personnage → Veo
        // garde la même voix au lieu d'en réinventer une par clip.
        const voiceDesc = member?.voiceSignature?.trim() || (member?.style ? `expressive cartoon voice, ${member.style}` : 'an expressive, distinctive cartoon voice')
        const veoPrompt = `${sc.imagePrompt}. The character "${who}" says in ${opts.lang === 'en' ? 'English' : 'French'}, EXACTLY: « ${sc.narration} ». VOICE — use this EXACT SAME voice for "${who}" in every single scene, never change it between scenes: ${voiceDesc}. Speak at a brisk, energetic TikTok pace — no slow delivery, no dead air before or after the line. Lip-sync must be perfectly accurate: the mouth shapes match each spoken syllable and start/stop exactly with the speech. Expressive face and natural hand gestures while speaking; the other characters stay silent and only listen. Keep the characters, their outfits and the art style strictly identical to the first frame. Vivid colors.
AUDIO — CRITICAL: the ONLY audio is that spoken line, dry and clean. Absolutely NO background music, NO soundtrack, NO score, NO singing, NO musical instrument of any kind, no sound effects; at most an almost inaudible room tone. Silence apart from the voice.
NO TEXT — CRITICAL: nothing written anywhere in the frame. No subtitles, no captions, no burned-in text, no titles, no signs, no labels, no watermark, no logo, no letters or numbers of any kind.`
        // 1) Google (quota gratuit) — 2 tentatives : évite qu'une scène bascule
        // sur une erreur passagère au milieu de la vidéo.
        let gotClip = false
        if (opts.geminiKey) {
          for (let attempt = 1; attempt <= 2 && !gotClip; attempt++) {
            log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Veo)${attempt > 1 ? ' — nouvelle tentative' : ''}…`)
            try {
              await genVideoVeoTalking(opts.geminiKey, veoPrompt, clip, png, veoDur)
              gotClip = true
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              if (attempt >= 2) log?.(`Scène ${i + 1}/${scenes.length} — Veo Google indisponible (${msg})${opts.deepinfraKey ? ' → essai via DeepInfra' : ' → voix TTS + animation'}`)
              else await new Promise((r) => setTimeout(r, 8000))
            }
          }
        }
        // 2) Mode ANGLAIS : Seedance 1.5 Pro — voix natives + lip-sync comme Veo,
        // pour bien moins cher. (Disqualifié en français : répliques massacrées.)
        // ⚠️ DÉSACTIVÉ : vérifié en réel, Seedance IGNORE l'image de la scène et
        // invente des personnages sans rapport (une bouteille devient une écolière).
        // C'est ce qui faisait « les personnages ne sont pas respectés ». Réactiver
        // seulement si DeepInfra corrige le conditionnement par image.
        if (!gotClip && opts.lang === 'en' && opts.deepinfraKey && opts.seedanceTalking) {
          log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Seedance, EN)…`)
          try {
            await genVideoSeedanceTalking(opts.deepinfraKey, veoPrompt, clip, png, veoDur)
            gotClip = true
          } catch (e) {
            log?.(`Scène ${i + 1}/${scenes.length} — Seedance indisponible (${e instanceof Error ? e.message : String(e)})`)
          }
        }
        // 3) Seedance 2.0 : voix native + lip-sync + personnage fidèle, ~30 % moins
        // cher que Veo. Passe par `reference_images`, qui exige une URL publique.
        if (!gotClip && opts.deepinfraKey && opts.paidEngine === 'seedance' && opts.publishPublic) {
          log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Seedance 2.0)…`)
          const pub = await opts.publishPublic(png).catch(() => null)
          try {
            if (!pub) throw new Error('aucune URL publique configurée (PUBLIC_URL)')
            await genVideoSeedance2(opts.deepinfraKey, veoPrompt, clip, pub.url, veoDur)
            gotClip = true
          } catch (e) {
            log?.(`Scène ${i + 1}/${scenes.length} — Seedance 2.0 indisponible (${e instanceof Error ? e.message : String(e)})`)
          } finally {
            await pub?.cleanup()
          }
        }
        // 4) Veo payant : le plus cher, réservé au mode « qualité max ». Sinon on
        // descend sur animation + voix ElevenLabs (~4× moins cher) juste en dessous.
        if (!gotClip && opts.deepinfraKey && opts.paidEngine === 'veo') {
          log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Veo via DeepInfra)…`)
          try {
            await genVideoVeoDeepinfra(opts.deepinfraKey, veoPrompt, clip, png)
            gotClip = true
          } catch (e) {
            log?.(`Scène ${i + 1}/${scenes.length} — DeepInfra Veo indisponible (${e instanceof Error ? e.message : String(e)}) → voix TTS + animation`)
          }
        }
        if (gotClip) {
          const clipDur = await mediaDuration(ctx.bin.ffprobe, clip)
          // La voix est générée PAR le modèle : on ne connaît son rythme qu'en
          // l'écoutant. Sans ce calage, les mots défilaient sur toute la durée du
          // clip (silences compris) → décalage très visible.
          const timed = await speechWordTimings(ctx, clip, work, i, { deepinfraKey: opts.deepinfraKey, groqKey: opts.groqKey }, log)
          await writeFile(ass, sceneAss(subText, clipDur, timed, opts.subStyle))
          await run(ctx.bin.ffmpeg, [
            '-y', '-loglevel', 'error',
            '-i', clip,
            // Veo incruste parfois SES propres sous-titres (du charabia : « ofiur o
            // tièsoor »), à une hauteur VARIABLE dans le bas de l'image — 15 % ne
            // suffisaient pas (réapparu à ~82 %). On coupe 22 % du bas AVANT le
            // cadrage ; le prompt seul n'y suffit pas, on ne perd que du décor.
            '-filter_complex',
            `[0:v]crop=iw:ih*0.78:0:0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1${subFilter}[v]`,
            '-map', '[v]', '-map', '0:a?',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
            scene
          ])
          sceneFiles.push(scene)
          sceneDone = true
        }
      }
      if (sceneDone) continue

      // 2b) Chemin classique : voix TTS (jouée par personnage) puis animation fal.ai / Ken Burns.
      // Source MUETTE : aucune voix générée — la durée de la scène est déduite du
      // texte (temps de lecture du sous-titre), et la piste audio reste vide.
      const mp3 = join(work, `a${i}.mp3`)
      let dur: number
      if (opts.mute) {
        log?.(`Scène ${i + 1}/${scenes.length} — source muette : aucune voix`)
        // ~13 caractères/seconde de lecture confortable, borné à 2,5–8 s.
        dur = Math.max(2.5, Math.min(8, sc.narration.length / 13 + 1))
        // Piste SILENCIEUSE de la même durée : tout le montage en aval (et le
        // concat final) attend une piste audio — inutile de le dupliquer.
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', dur.toFixed(2), '-c:a', 'libmp3lame', mp3
        ])
      } else {
        const eleven = elevenMode
        // ElevenLabs : une voix HUMAINE distincte par personnage (répartie plus haut) ;
        // sinon casting OpenAI (timbre par personnage).
        const sceneVoice = eleven
          ? (sc.speaker && elevenCast.get(sc.speaker.trim().toLowerCase())) || elevenFallbackVoice || voice
          : member && OPENAI_VOICES.includes(member.voice) ? member.voice : voice
        log?.(`Scène ${i + 1}/${scenes.length} — voix${member ? ` de ${member.name}` : ' off'}…`)
        await tts(
          sceneVoice,
          sc.narration,
          mp3,
          { openaiKey: opts.openaiKey, provider: opts.voiceProvider, elevenKey: opts.elevenKey, speed: opts.speechSpeed, ffmpeg: (a) => run(ctx.bin.ffmpeg, a), onNote: log },
          eleven ? undefined : member ? `${member.name} — ${member.style}` : undefined
        )
        dur = (await mediaDuration(ctx.bin.ffprobe, mp3)) + 0.4
      }

      let animClip: string | null = null
      let lipSynced = false
      // p-video : anime l'image EN SE CALANT SUR notre piste vocale → vraie synchro
      // labiale avec des voix constantes, pour ~7× moins cher qu'une scène Veo.
      // (Le modèle télécharge image + audio par URL : d'où la publication éphémère.)
      if (opts.animateScenes && !opts.mute && opts.paidEngine === 'wan' && opts.deepinfraKey && opts.publishPublic) {
        log?.(`Scène ${i + 1}/${scenes.length} — scène parlée (Wan 2.7, synchro sur la voix)…`)
        const pub: { url: string; cleanup: () => Promise<void> }[] = []
        try {
          const img = await opts.publishPublic(png)
          const aud = await opts.publishPublic(mp3)
          if (!img || !aud) throw new Error('aucune URL publique configurée (PUBLIC_URL)')
          pub.push(img, aud)
          const target = join(work, `v${i}.mp4`)
          await genVideoWan27(
            opts.deepinfraKey,
            `The character speaks the provided audio with accurate lip-sync, expressive face and natural head motion. Keep the exact same character, outfit, colors and art style as the first frame. No on-screen text, no captions, no subtitles.`,
            target,
            img.url,
            aud.url
          )
          animClip = target
          lipSynced = true // clip DÉJÀ calé sur la voix → montage sans étirement
        } catch (e) {
          log?.(`Scène ${i + 1}/${scenes.length} — Wan 2.7 indisponible (${e instanceof Error ? e.message : String(e)}) → animation simple`)
        } finally {
          for (const p of pub) await p.cleanup()
        }
      }
      if (!animClip && opts.animateScenes && (opts.deepinfraKey || opts.falKey)) {
        // Pas de lip-sync ici : on n'insiste PAS sur la bouche (sinon un
        // mouvement de lèvres non synchronisé se remarque). On mise sur
        // l'expression et les gestes ; les sous-titres portent la réplique.
        const talking = opts.mute
          ? ''
          : sc.speaker
            ? ` The character "${sc.speaker}" is speaking, with a lively expressive face, subtle natural head motion and hand gestures.`
            : ''
        // Source muette : PERSONNE ne parle, mais les bruits de la scène (pas,
        // objets, ambiance) font partie de ce qu'on reproduit → on les demande.
        const ambient = opts.mute
          ? ' Nobody speaks: no dialogue, no voice, no narration, no singing — only the natural diegetic sounds of the scene (objects, movement, room ambience).'
          : ''
        const animPrompt = `Animate this exact scene keeping the characters and art style strictly identical: ${sc.imagePrompt}.${talking} Natural lively character motion, smooth cinematic camera movement, vivid colors, no text.${ambient}`
        const target = join(work, `v${i}.mp4`)
        // ⚠️ NE PAS mettre Seedance ici : testé, il IGNORE l'image de départ et
        // invente une scène sans rapport (cf. genVideoSeedanceTalking). Pixverse,
        // lui, la respecte fidèlement — c'est ce qui garde les personnages.
        if (!animClip && opts.deepinfraKey) {
          log?.(`Scène ${i + 1}/${scenes.length} — animation vidéo (Pixverse)${opts.mute ? ' + ambiance sonore' : ''}…`)
          try {
            await genVideoDeepinfra(opts.deepinfraKey, animPrompt, target, png, dur > 6.5 ? 10 : 5, undefined, !!opts.mute)
            animClip = target
          } catch (e) {
            log?.(`Scène ${i + 1}/${scenes.length} — Pixverse indisponible (${e instanceof Error ? e.message : String(e)})${opts.falKey ? ' → fal.ai' : ' → image animée'}`)
          }
        }
        if (!animClip && opts.falKey) {
          log?.(`Scène ${i + 1}/${scenes.length} — animation vidéo (fal.ai)…`)
          try {
            await genVideoFal(
              opts.falKey,
              animPrompt,
              target,
              png,
              opts.falVideoModel || FAL_DEFAULT_MODEL,
              dur > 6.5 ? '10' : '5' // réplique longue → clip plus long (évite l'étirement excessif)
            )
            animClip = target
          } catch (e) {
            animClip = null
            log?.(`Scène ${i + 1}/${scenes.length} — fal.ai indisponible (${e instanceof Error ? e.message : String(e)}) → image animée`)
          }
        }
        // Moteur « lipsync » : cale la BOUCHE du clip animé sur la voix TTS (fixe
        // par personnage) → voix constante + lèvres synchro sur toutes les scènes.
        if (animClip && opts.falKey && !opts.mute && opts.videoEngine === 'lipsync') {
          log?.(`Scène ${i + 1}/${scenes.length} — synchronisation labiale (fal.ai)…`)
          try {
            const synced = join(work, `ls${i}.mp4`)
            await genLipsyncFal(opts.falKey, animClip, mp3, synced, opts.falLipsyncModel || FAL_LIPSYNC_MODEL)
            animClip = synced
            lipSynced = true
          } catch (e) {
            log?.(`Scène ${i + 1}/${scenes.length} — lip-sync indisponible (${e instanceof Error ? e.message : String(e)}) → animation simple`)
          }
        }
      }

      log?.(`Scène ${i + 1}/${scenes.length} — montage…`)
      // Calage des sous-titres sur la voix RÉELLE (TTS) — inutile en muet.
      const timedTts = opts.mute
        ? null
        : await speechWordTimings(ctx, mp3, work, i, { deepinfraKey: opts.deepinfraKey, groqKey: opts.groqKey }, log)
      await writeFile(ass, sceneAss(subText, dur, timedTts, opts.subStyle))
      if (animClip && opts.mute) {
        // Source MUETTE : aucune voix à caler → on garde le clip TEL QUEL (pas de
        // setpts) avec SA piste d'ambiance si le modèle en a produit une ; sinon
        // la piste silencieuse, pour que toutes les scènes aient bien de l'audio
        // (le concat final l'exige).
        const clipDur = await mediaDuration(ctx.bin.ffprobe, animClip)
        const ambient = await hasAudioStream(ctx.bin.ffprobe, animClip)
        await writeFile(ass, sceneAss(subText, clipDur, null, opts.subStyle)) // muet : aucune parole à caler
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-i', animClip,
          ...(ambient ? [] : ['-i', mp3]),
          '-filter_complex',
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1${subFilter}[v]`,
          '-map', '[v]', '-map', ambient ? '0:a' : '1:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          '-shortest',
          scene
        ])
        if (!ambient) log?.(`Scène ${i + 1}/${scenes.length} — pas d’ambiance sonore fournie par le modèle (scène silencieuse)`)
        sceneFiles.push(scene)
        continue
      }
      if (animClip && lipSynced) {
        // Clip DÉJÀ synchronisé (bouche calée sur la voix) : on garde la vidéo
        // TELLE QUELLE — surtout PAS de setpts (ça désynchroniserait les lèvres)
        // — on recadre, on brûle le sous-titre et on remet la voix TTS d'origine
        // (garantie présente et déjà celle sur laquelle la bouche a été calée).
        const clipDur = await mediaDuration(ctx.bin.ffprobe, animClip)
        // Même voix TTS que ci-dessus → on réutilise ses timings réels.
        await writeFile(ass, sceneAss(subText, clipDur, timedTts, opts.subStyle))
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-i', animClip,
          '-i', mp3,
          '-filter_complex',
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1${subFilter}[v]`,
          '-map', '[v]', '-map', '1:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          '-shortest',
          scene
        ])
      } else if (animClip) {
        // Clip animé : recadré 1080x1920 et ÉTIRÉ/COMPRESSÉ en douceur (setpts)
        // pour couvrir exactement la durée de la voix — plus aucun gel d'image.
        const clipDur = await mediaDuration(ctx.bin.ffprobe, animClip)
        const ratio = Math.max(0.5, Math.min(2.5, dur / Math.max(0.5, clipDur)))
        await run(ctx.bin.ffmpeg, [
          '-y', '-loglevel', 'error',
          '-i', animClip,
          '-i', mp3,
          '-filter_complex',
          // Le modèle d'animation glisse parfois un horodatage ou un filigrane
          // sur le bord bas (« 17-38 2D-E-4?b… »). On rogne 8 % : assez pour les
          // faire disparaître, trop peu pour amputer la scène.
          `[0:v]crop=iw:ih*0.92:0:0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts=${ratio.toFixed(4)}*PTS,fps=30,setsar=1${subFilter}[v]`,
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
          `[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,zoompan=z='min(zoom+0.0004,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1${subFilter}[v]`,
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
