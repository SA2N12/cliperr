import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { run, type PipelineContext } from '../src/main/pipeline/context'
import type { Usage } from '../src/main/pipeline/highlights'
import { genImage } from './video-gen'

// Génération d'un CARROUSEL PHOTO TikTok (« post images ») adapté à la niche du
// compte : Claude écrit les diapos → une image IA par diapo → le texte est
// incrusté par ffmpeg (typographie maîtrisée, bien plus fiable que du texte
// dessiné par le modèle d'image) → JPEG (TikTok refuse le PNG).

const SlideSchema = z.object({
  text: z.string(),
  imagePrompt: z.string()
})
const CarouselSchema = z.object({
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  slides: z.array(SlideSchema)
})
export type Carousel = z.infer<typeof CarouselSchema>

/** Nombre de diapos visé (1 hook + le corps + 1 chute). */
const SLIDES = 6

/** Écrit le carrousel (diapos + légende) avec Claude, dans la niche du compte. */
export async function buildCarousel(
  anthropicKey: string,
  model: string,
  niche: string,
  cta: string
): Promise<{ carousel: Carousel | null; usage: Usage | null }> {
  const client = new Anthropic({ apiKey: anthropicKey })
  const tool = {
    name: 'carrousel',
    description: 'Écrit un carrousel photo TikTok (diapos + légende).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre interne court du carrousel.' },
        caption: { type: 'string', description: 'Légende du post (1 à 2 phrases + question finale).' },
        hashtags: { type: 'array', items: { type: 'string' }, description: '4 à 6 hashtags, avec le #.' },
        slides: {
          type: 'array',
          description: `Exactement ${SLIDES} diapos, dans l'ordre.`,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Texte affiché sur la diapo. TRÈS court.' },
              imagePrompt: { type: 'string', description: "Prompt d'image en anglais, sans aucun texte." }
            },
            required: ['text', 'imagePrompt']
          }
        }
      },
      required: ['title', 'caption', 'hashtags', 'slides']
    }
  } as Anthropic.Tool

  const prompt = `Tu écris un CARROUSEL PHOTO pour TikTok (des images qu'on fait défiler, pas une vidéo) dans la niche : « ${niche} ».

Le format carrousel se lit en silence : c'est le TEXTE sur l'image qui fait tout le travail.

Produis EXACTEMENT ${SLIDES} diapos :
1. Diapo 1 = le HOOK. Une promesse ou une affirmation choc qui donne envie de swiper. Maximum 8 mots.
2. Diapos 2 à ${SLIDES - 1} = le contenu, une idée par diapo, dans un ordre qui monte en intensité (garde le plus fort pour la fin).
3. Diapo ${SLIDES} = la chute + une raison de commenter (question ouverte, avis à donner).

Règles de TEXTE (le plus important) :
- Chaque texte de diapo : 12 mots MAXIMUM, en français, phrases nominales percutantes. Pas de blabla, pas d'introduction.
- Zéro numérotation ni « 1. », « 2. » : la position dans le carrousel suffit.
- Concret et vérifiable : des faits, des chiffres, des exemples précis — jamais de généralités.
- Sujets connus/googlables plutôt qu'obscurs : on doit pouvoir reconnaître de quoi on parle.

Règles d'IMAGE (le générateur refuse sinon) : aucun ENFANT ni mineur, aucune personne réelle identifiable, pas de gore ni de contenu sexuel. Illustre autrement (objet, décor, document, symbole, main d'adulte).
Chaque imagePrompt est en anglais, très détaillé, cinématographique, vertical, et NE CONTIENT AUCUN TEXTE (le texte est ajouté après).
Garde une cohérence visuelle forte entre les ${SLIDES} diapos (même ambiance, même palette).

Légende : 1 à 2 phrases qui donnent envie, puis une question qui appelle un commentaire.${cta ? `\nTermine la légende par ce CTA : « ${cta} »` : ''}

Réponds uniquement via l'outil carrousel.`

  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'carrousel' },
    messages: [{ role: 'user', content: prompt }]
  })
  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { carousel: null, usage }
  const parsed = CarouselSchema.safeParse(block.input)
  if (!parsed.success) return { carousel: null, usage }
  const c = parsed.data
  return { carousel: { ...c, slides: c.slides.slice(0, 10) }, usage }
}

function assEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim()
}

/**
 * Sous-titre ASS d'une diapo. Le hook est centré et plus gros ; les autres
 * diapos posent le texte dans le tiers bas, au-dessus de la zone où TikTok
 * affiche ses propres éléments d'interface.
 */
function slideAss(text: string, hook: boolean): string {
  const size = hook ? 96 : 76
  const align = hook ? 5 : 2 // 5 = centré au milieu, 2 = bas centré
  const marginV = hook ? 0 : 520
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Def,Liberation Sans,${size},&H00FFFFFF,&H00000000,&H96000000,1,0,1,7,4,${align},110,110,${marginV}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Def,,0,0,0,,${assEscape(text)}`
}

export interface CarouselGenOptions {
  anthropicKey: string
  anthropicModel?: string
  openaiKey: string
  niche: string
  cta?: string
  onProgress?: (m: string) => void
}

/**
 * Produit les JPEG d'un carrousel prêt à publier. Renvoie les fichiers dans
 * l'ordre des diapos (le premier sert de couverture).
 */
export async function generateCarousel(
  ctx: PipelineContext,
  opts: CarouselGenOptions
): Promise<{ files: string[]; carousel: Carousel; usage: Usage | null }> {
  const log = opts.onProgress
  log?.('Écriture du carrousel (IA)…')
  const { carousel, usage } = await buildCarousel(
    opts.anthropicKey,
    opts.anthropicModel || 'claude-haiku-4-5',
    opts.niche,
    opts.cta ?? ''
  )
  if (!carousel || !carousel.slides.length) throw new Error('Carrousel vide — réessaie')

  const stamp = Date.now()
  const work = join(ctx.dirs.downloads, `carousel-${stamp}`)
  await mkdir(work, { recursive: true })
  // Les JPEG finaux vivent dans le dossier des clips : servis et publiables.
  const out: string[] = []
  try {
    for (let i = 0; i < carousel.slides.length; i++) {
      const s = carousel.slides[i]
      log?.(`Diapo ${i + 1}/${carousel.slides.length} — image IA…`)
      const png = join(work, `s${i}.png`)
      await genImage(opts.openaiKey, s.imagePrompt, png, log)

      const ass = join(work, `s${i}.ass`)
      await writeFile(ass, slideAss(s.text, i === 0))
      const jpg = join(ctx.dirs.clips, `carousel-${stamp}-${String(i).padStart(2, '0')}.jpg`)
      // Cadrage 9:16 + assombrissement léger (lisibilité du texte) + incrustation.
      // `-frames:v 1` : on ne produit qu'une image fixe. Sortie JPEG car TikTok
      // n'accepte que JPG/JPEG/WEBP pour les posts photo.
      await run(ctx.bin.ffmpeg, [
        '-y',
        '-loglevel',
        'error',
        '-i',
        png,
        '-vf',
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.08:saturation=1.06,subtitles=${ass}`,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        jpg
      ])
      out.push(jpg)
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
  return { files: out, carousel, usage }
}
