import { copyFile, mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { ClipDTO } from '../../shared/types'

/** Copie le clip dans le dossier d'export + écrit la légende dans un .txt. */
export async function exportClip(clip: ClipDTO, exportDir: string): Promise<string> {
  if (!clip.filePath) throw new Error('Clip sans fichier')
  await mkdir(exportDir, { recursive: true })
  const base = basename(clip.filePath)
  const dest = join(exportDir, base)
  await copyFile(clip.filePath, dest)

  const caption = [clip.title, clip.description, clip.hashtags].filter(Boolean).join('\n\n')
  await writeFile(dest.replace(/\.mp4$/i, '.txt'), caption, 'utf8')
  return dest
}
