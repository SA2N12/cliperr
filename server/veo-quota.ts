import { getSetting, setSetting } from '../src/main/db/repo'

// ── Quota Veo (Gemini) ──────────────────────────────────────────────────────
// Veo est en preview : chaque modèle a un petit quota JOURNALIER (RPD, ~10/jour).
// En cumulant les 3 variantes (fast + full + lite) on triple la capacité du jour.
// On compte nous-mêmes les requêtes acceptées pour : (a) répartir sur les modèles
// qui ont encore du quota, (b) afficher le nombre de vidéos restantes.
// NB : compteur relatif à CETTE app (ne voit pas l'usage fait ailleurs) ; le vrai
// garde-fou reste le 429 de Google, qui marque le modèle épuisé pour la journée.

// Du meilleur (fast) au plus léger (lite). `lite` a le plus de marge → filet.
export const VEO_MODELS = ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'veo-3.1-lite-generate-preview']
const DEFAULT_RPD = 10
/** Nombre de scènes typique d'une repro → sert à convertir requêtes ↔ vidéos. */
export const VEO_SCENES_PER_VIDEO = 8

function dailyLimit(): number {
  const v = parseInt(getSetting('veo_daily_limit') || '', 10)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RPD
}
// Les RPD Google se réinitialisent à minuit heure du Pacifique.
function pacificDay(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
type Usage = { day: string; counts: Record<string, number> }
function load(): Usage {
  try {
    const raw = getSetting('veo_usage')
    if (raw) {
      const u = JSON.parse(raw) as Usage
      if (u && u.day === pacificDay() && u.counts && typeof u.counts === 'object') return u
    }
  } catch {
    /* ignore */
  }
  return { day: pacificDay(), counts: {} }
}
function save(u: Usage): void {
  setSetting('veo_usage', JSON.stringify(u))
}

/** Modèles encore utilisables aujourd'hui (quota non atteint), dans l'ordre de préférence. */
export function veoAvailableModels(): string[] {
  const u = load()
  const L = dailyLimit()
  return VEO_MODELS.filter((m) => (u.counts[m] ?? 0) < L)
}
/** Comptabilise une requête Veo ACCEPTÉE (elle compte pour le RPD). */
export function noteVeoUse(model: string): void {
  const u = load()
  u.counts[model] = (u.counts[model] ?? 0) + 1
  save(u)
}
/** Marque un modèle comme épuisé pour la journée (429 quota de Google). */
export function markVeoExhausted(model: string): void {
  const u = load()
  u.counts[model] = dailyLimit()
  save(u)
}
/** État du quota Veo du jour, pour l'UI. */
export function veoQuota(): {
  limit: number
  perModel: { model: string; used: number; left: number }[]
  remainingRequests: number
  remainingVideos: number
  scenesPerVideo: number
} {
  const u = load()
  const L = dailyLimit()
  const perModel = VEO_MODELS.map((m) => {
    const used = Math.min(L, u.counts[m] ?? 0)
    return { model: m, used, left: L - used }
  })
  const remainingRequests = perModel.reduce((s, m) => s + m.left, 0)
  return {
    limit: L,
    perModel,
    remainingRequests,
    remainingVideos: Math.floor(remainingRequests / VEO_SCENES_PER_VIDEO),
    scenesPerVideo: VEO_SCENES_PER_VIDEO
  }
}
