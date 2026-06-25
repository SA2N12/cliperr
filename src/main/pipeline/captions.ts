import { writeFile } from 'fs/promises'
import type { Word } from './transcribe'

/** Mots tombant dans [start,end], recalés à 0 (relatifs au clip). */
export function wordsInRange(words: Word[], start: number, end: number): Word[] {
  return words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - start),
      end: Math.max(0, Math.min(end, w.end) - start)
    }))
}

/** Secondes → timecode ASS H:MM:SS.cc */
function ts(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

function escapeText(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ')
}

export interface AssOptions {
  width: number
  height: number
  fontSize?: number
}

/**
 * Génère un fichier ASS affichant un mot à la fois, gros et centré (style
 * TikTok). Chaque mot reste affiché jusqu'au début du suivant (continu).
 */
export function buildAss(words: Word[], opts: AssOptions): string {
  const fontSize = opts.fontSize ?? Math.round(opts.height * 0.06)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const lines: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const start = w.start
    const end = i + 1 < words.length ? Math.max(w.end, words[i + 1].start) : w.end + 0.3
    if (end <= start) continue
    lines.push(
      `Dialogue: 0,${ts(start)},${ts(end)},Default,,0,0,0,,{\\fad(60,60)}${escapeText(w.text.toUpperCase())}`
    )
  }
  return header + lines.join('\n') + '\n'
}

export async function writeAss(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}
