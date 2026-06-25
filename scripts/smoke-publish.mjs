// Valide les presets cron (node-cron) + la logique d'export (copie + sidecar légende).
import cron from 'node-cron'
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises'
import { join, basename } from 'node:path'

const CRON_PRESETS = ['*/15 * * * *', '*/30 * * * *', '0 * * * *', '0 */3 * * *', '0 9,17 * * *']
for (const c of CRON_PRESETS) {
  if (!cron.validate(c)) {
    console.error(`Cron invalide: ${c}`)
    process.exit(1)
  }
}
if (cron.validate('pas-un-cron')) {
  console.error('cron.validate aurait dû rejeter une expression invalide')
  process.exit(1)
}
console.log(`✓ ${CRON_PRESETS.length} presets cron valides, invalide bien rejeté`)

// Export : copie le clip + écrit la légende dans un .txt (mirroir de exportClip)
const dir = join(process.cwd(), '.tmp-bin')
const exportDir = join(dir, 'export')
await mkdir(dir, { recursive: true })
const clip = join(dir, '3-0.mp4')
await writeFile(clip, Buffer.from('FAKEVIDEO'))
await mkdir(exportDir, { recursive: true })
const dest = join(exportDir, basename(clip))
await copyFile(clip, dest)
const caption = ['Mon titre', 'Une description punchy', '#tiktok #clip #viral'].join('\n\n')
await writeFile(dest.replace(/\.mp4$/i, '.txt'), caption, 'utf8')
await access(dest)
await access(dest.replace(/\.mp4$/i, '.txt'))
console.log('✓ export : clip copié + légende .txt écrite')
console.log('\nOK — cron + export validés.')
