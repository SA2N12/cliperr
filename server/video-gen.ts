import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { run, runCapture, type PipelineContext } from '../src/main/pipeline/context'
import type { Usage } from '../src/main/pipeline/highlights'
import type { ViralIdea } from '../src/shared/types'

// Génération d'une vidéo « faceless » 9:16 à partir d'une idée :
// storyboard (Claude) → voix off (OpenAI TTS) + image IA par scène (DALL·E) →
// montage ffmpeg (Ken Burns + sous-titres incrustés) → MP4 vertical.

const OPENAI = 'https://api.openai.com/v1'

const SceneSchema = z.object({ narration: z.string(), imagePrompt: z.string() })
const StoryboardSchema = z.object({ scenes: z.array(SceneSchema) })
export interface Scene {
  narration: string
  imagePrompt: string
}

export interface VideoGenOptions {
  anthropicKey: string
  anthropicModel?: string
  openaiKey: string
  voice?: string
  idea: ViralIdea
  /** Chemin d'une musique de fond (libre de droits) à mixer sous la voix. */
  musicTrack?: string
  onProgress?: (msg: string) => void
}

/** Découpe l'idée en 4–6 scènes (voix off FR + prompt image EN) via Claude. */
async function buildStoryboard(
  key: string,
  model: string,
  idea: ViralIdea
): Promise<{ scenes: Scene[]; usage: Usage | null }> {
  const client = new Anthropic({ apiKey: key })
  const tool = {
    name: 'storyboard',
    description: 'Découpe une idée de vidéo TikTok en scènes (voix off + visuel).',
    input_schema: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              narration: {
                type: 'string',
                description: 'Une phrase de voix off en français, courte, orale et percutante (une seule phrase)'
              },
              imagePrompt: {
                type: 'string',
                description:
                  'Description visuelle en anglais, concrète et esthétique, pour une image verticale ; AUCUN texte, logo ni watermark'
              }
            },
            required: ['narration', 'imagePrompt']
          }
        }
      },
      required: ['scenes']
    }
  } satisfies Anthropic.Tool

  const prompt = `Transforme cette idée de vidéo TikTok en un storyboard de 4 à 6 scènes pour une vidéo verticale « faceless ».
Titre : ${idea.title}
Hook : ${idea.hook}
Script : ${idea.script.join(' ')}

Pour chaque scène : une phrase de VOIX OFF en français (courte, orale, accrocheuse — la 1re scène reprend/adapte le hook), et un IMAGE PROMPT en anglais décrivant un visuel vertical concret et cinématographique (pas de texte à l'image). Commence fort, garde un rythme rapide. Réponds uniquement via l'outil storyboard.`

  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'storyboard' },
    messages: [{ role: 'user', content: prompt }]
  })
  const usage: Usage | null = msg.usage
    ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    : null
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return { scenes: [], usage }
  const parsed = StoryboardSchema.safeParse(block.input)
  if (!parsed.success) return { scenes: [], usage }
  return { scenes: parsed.data.scenes.slice(0, 8), usage }
}

/** Choisit, via Claude, la musique la plus adaptée à la vidéo parmi les pistes dispo (d'après leurs noms). */
export async function chooseMusicTrack(
  key: string,
  model: string,
  idea: ViralIdea,
  tracks: string[]
): Promise<string | null> {
  if (!tracks.length) return null
  if (tracks.length === 1) return tracks[0]
  const fallback = tracks[Math.floor(Math.random() * tracks.length)]
  try {
    const client = new Anthropic({ apiKey: key })
    const tool = {
      name: 'pick_music',
      description: 'Choisit la musique de fond la plus adaptée à la vidéo.',
      input_schema: {
        type: 'object',
        properties: {
          track: { type: 'string', enum: tracks, description: 'Nom EXACT du fichier de musique le plus adapté' }
        },
        required: ['track']
      }
    } satisfies Anthropic.Tool
    const prompt = `Choisis la musique de fond la plus adaptée à cette vidéo TikTok, en jugeant d'après les NOMS de fichiers (ils indiquent souvent le style/l'ambiance : epic, chill, hype, sad, funny…).
Titre : ${idea.title}
Hook : ${idea.hook}
Ambiance : ${idea.script.join(' ')}
Musiques disponibles : ${tracks.join(', ')}
Réponds via l'outil pick_music en choisissant un nom EXACT de la liste.`
    const msg = await client.messages.create({
      model,
      max_tokens: 200,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'pick_music' },
      messages: [{ role: 'user', content: prompt }]
    })
    const block = msg.content.find((b) => b.type === 'tool_use')
    if (block && block.type === 'tool_use') {
      const t = (block.input as { track?: string }).track
      if (typeof t === 'string' && tracks.includes(t)) return t
    }
  } catch {
    /* en cas d'échec IA, on retombe sur un choix aléatoire */
  }
  return fallback
}

/** Voix off OpenAI (tts-1) → fichier mp3. */
async function tts(openaiKey: string, voice: string, text: string, dest: string): Promise<void> {
  const res = await fetch(`${OPENAI}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'mp3' })
  })
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status} : ${(await res.text()).slice(0, 200)}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

/** Image IA verticale (DALL·E 3, 1024×1792) → fichier png. Gère réponse b64 OU url. */
async function genImage(openaiKey: string, prompt: string, dest: string): Promise<void> {
  const res = await fetch(`${OPENAI}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `${prompt}. Vertical 9:16 cinematic composition, high detail, no text, no watermark.`,
      size: '1024x1536',
      quality: 'medium',
      n: 1
    })
  })
  if (!res.ok) throw new Error(`OpenAI image ${res.status} : ${(await res.text()).slice(0, 200)}`)
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
Style: Def,Liberation Sans,60,&H00FFFFFF,&H00000000,&H00000000,1,0,1,5,2,2,100,100,300
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
  const { scenes, usage } = await buildStoryboard(
    opts.anthropicKey,
    opts.anthropicModel || 'claude-haiku-4-5',
    opts.idea
  )
  if (!scenes.length) throw new Error('Storyboard vide — réessaie')

  const stamp = Date.now()
  const work = join(ctx.dirs.downloads, `idea-${stamp}`)
  await mkdir(work, { recursive: true })
  const sceneFiles: string[] = []
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i]
      log?.(`Scène ${i + 1}/${scenes.length} — voix off…`)
      const mp3 = join(work, `a${i}.mp3`)
      await tts(opts.openaiKey, voice, sc.narration, mp3)
      const dur = (await mediaDuration(ctx.bin.ffprobe, mp3)) + 0.4

      log?.(`Scène ${i + 1}/${scenes.length} — image IA…`)
      const png = join(work, `i${i}.png`)
      await genImage(opts.openaiKey, sc.imagePrompt, png)

      log?.(`Scène ${i + 1}/${scenes.length} — montage…`)
      const ass = join(work, `s${i}.ass`)
      await writeFile(ass, sceneAss(sc.narration, dur))
      const scene = join(work, `scene${i}.mp4`)
      const frames = Math.max(1, Math.round(dur * 30))
      await run(ctx.bin.ffmpeg, [
        '-y',
        '-loglevel',
        'error',
        '-loop',
        '1',
        '-i',
        png,
        '-i',
        mp3,
        '-filter_complex',
        `[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,zoompan=z='min(zoom+0.0004,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1,subtitles=${ass}[v]`,
        '-map',
        '[v]',
        '-map',
        '1:a',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-t',
        String(dur),
        scene
      ])
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
      // Musique bouclée sous la voix (bien audible mais dominée par la voix),
      // limiteur pour éviter la saturation.
      await run(ctx.bin.ffmpeg, [
        '-y', '-loglevel', 'error',
        '-i', concatPath,
        '-stream_loop', '-1', '-i', opts.musicTrack,
        '-filter_complex',
        `[1:a]volume=0.30,afade=t=out:st=${fadeSt.toFixed(2)}:d=2[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97[a]`,
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
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
