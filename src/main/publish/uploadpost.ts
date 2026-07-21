import { openAsBlob } from 'fs'
import { basename } from 'path'

// Publication via upload-post.com : un agrégateur qui poste sur TikTok (et
// d'autres réseaux) via SON app officielle auditée. Avantage vs l'API TikTok
// directe non auditée : publication PUBLIQUE possible (pas de SELF_ONLY forcé)
// et limites normales. Nécessite un plan payant (TikTok non inclus dans l'offre
// gratuite) : clé API + identifiant de profil « user » connecté côté upload-post.

export interface UploadPostParams {
  apiKey: string
  user: string
  filePath: string
  caption: string
  privacyLevel?: string
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  /** Journal (diagnostic des réponses ambiguës d'upload-post). */
  onNote?: (m: string) => void
}

interface UploadPostResult {
  success?: boolean
  error?: string
  /** upload-post renvoie parfois `message` (ou `detail`) au lieu de `error`. */
  message?: string
  detail?: string
  request_id?: string
  results?: { tiktok?: { success?: boolean; url?: string; error?: string } }
}

/**
 * Message d'erreur exploitable. Sans ce repli sur le corps brut, un 400 dont le
 * detail n'est pas dans `error` se resumait a « HTTP 400 » — impossible a
 * diagnostiquer (cas vecu sur un carrousel).
 */
function errText(json: UploadPostResult, raw: string, status: number): string {
  const m = json.error || json.message || json.detail
  if (m) return m
  const body = raw.trim().slice(0, 300)
  return body ? `HTTP ${status} — ${body}` : `HTTP ${status}`
}

/** Extrait l'ID de la vidéo TikTok d'une URL (…/video/<id>). */
function postIdFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/video\/(\d+)/)
  return m ? m[1] : null
}

/** Poste un clip sur TikTok via upload-post. Renvoie l'URL + l'ID du post si dispo. */
export async function uploadPostTikTok(p: UploadPostParams): Promise<{ url: string | null; postId: string | null }> {
  if (!p.apiKey) throw new Error('Clé API upload-post manquante')
  if (!p.user) throw new Error('Identifiant de profil upload-post (« user ») manquant')

  const form = new FormData()
  const blob = await openAsBlob(p.filePath, { type: 'video/mp4' })
  form.append('video', blob, basename(p.filePath))
  form.append('user', p.user)
  form.append('platform[]', 'tiktok')
  form.append('post_mode', 'DIRECT_POST')
  const caption = p.caption.slice(0, 2200)
  form.append('title', caption || 'clip')
  form.append('tiktok_title', caption)
  form.append('privacy_level', p.privacyLevel || 'PUBLIC_TO_EVERYONE')
  if (p.disableComment) form.append('disable_comment', 'true')
  if (p.disableDuet) form.append('disable_duet', 'true')
  if (p.disableStitch) form.append('disable_stitch', 'true')

  let res: Response
  try {
    res = await fetch('https://api.upload-post.com/api/upload', {
      method: 'POST',
      headers: { Authorization: `Apikey ${p.apiKey}` },
      body: form
    })
  } catch (e) {
    throw new Error(`upload-post injoignable : ${e instanceof Error ? e.message : e}`)
  }

  const text = await res.text()
  let json: UploadPostResult
  try {
    json = JSON.parse(text) as UploadPostResult
  } catch {
    throw new Error(`upload-post réponse invalide (HTTP ${res.status}) : ${text.slice(0, 200)}`)
  }

  // Cas synchrone : upload-post renvoie directement le résultat TikTok.
  const tt = json.results?.tiktok
  if (tt) {
    if (!res.ok || tt.success === false) {
      throw new Error(`upload-post : ${tt.error || errText(json, text, res.status)}`)
    }
    return { url: tt.url ?? null, postId: postIdFromUrl(tt.url) }
  }
  // Cas asynchrone : traité en tâche de fond → on suit le statut jusqu'au résultat réel.
  if (res.ok && json.success && json.request_id) {
    return pollUploadStatus(p.apiKey, json.request_id, p.onNote)
  }
  throw new Error(`upload-post : ${errText(json, text, res.status)}`)
}

export interface UploadPhotosParams {
  apiKey: string
  user: string
  /** JPEG dans l'ordre des diapos — le premier sert de couverture. */
  filePaths: string[]
  caption: string
  privacyLevel?: string
  disableComment?: boolean
  onNote?: (m: string) => void
}

/**
 * Poste un CARROUSEL PHOTO sur TikTok (endpoint `/api/upload_photos`).
 * TikTok n'accepte que JPG/JPEG/WEBP et ajoute lui-même la musique de fond
 * (`auto_add_music`) — on ne peut pas joindre de piste audio ici.
 */
export async function uploadPostTikTokPhotos(p: UploadPhotosParams): Promise<{ url: string | null; postId: string | null }> {
  if (!p.apiKey) throw new Error('Clé API upload-post manquante')
  if (!p.user) throw new Error('Identifiant de profil upload-post (« user ») manquant')
  if (!p.filePaths.length) throw new Error('Aucune image à publier')

  const form = new FormData()
  for (const f of p.filePaths) {
    form.append('photos[]', await openAsBlob(f, { type: 'image/jpeg' }), basename(f))
  }
  form.append('user', p.user)
  form.append('platform[]', 'tiktok')
  form.append('post_mode', 'DIRECT_POST')
  const caption = p.caption.slice(0, 2200)
  form.append('title', caption || 'carrousel')
  form.append('tiktok_title', caption)
  form.append('tiktok_description', caption)
  form.append('privacy_level', p.privacyLevel || 'PUBLIC_TO_EVERYONE')
  form.append('auto_add_music', 'true')
  form.append('photo_cover_index', '0')
  if (p.disableComment) form.append('disable_comment', 'true')

  let res: Response
  try {
    res = await fetch('https://api.upload-post.com/api/upload_photos', {
      method: 'POST',
      headers: { Authorization: `Apikey ${p.apiKey}` },
      body: form
    })
  } catch (e) {
    throw new Error(`upload-post injoignable : ${e instanceof Error ? e.message : e}`)
  }

  const text = await res.text()
  let json: UploadPostResult
  try {
    json = JSON.parse(text) as UploadPostResult
  } catch {
    throw new Error(`upload-post réponse invalide (HTTP ${res.status}) : ${text.slice(0, 200)}`)
  }

  const tt = json.results?.tiktok
  if (tt) {
    if (!res.ok || tt.success === false) {
      throw new Error(`upload-post (photos) : ${tt.error || errText(json, text, res.status)}`)
    }
    return { url: tt.url ?? null, postId: postIdFromUrl(tt.url) }
  }
  // Même politique que la vidéo : on ne conclut à l'échec que sur preuve explicite.
  if (res.ok && json.success && json.request_id) {
    return pollUploadStatus(p.apiKey, json.request_id, p.onNote)
  }
  throw new Error(`upload-post (photos) : ${errText(json, text, res.status)}`)
}

interface StatusResult {
  status?: string
  results?: Array<{ platform?: string; success?: boolean; post_url?: string; platform_post_id?: string; error_message?: string }>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Suit un upload asynchrone via GET /api/uploadposts/status jusqu'à son issue
 * réelle. Lève une erreur (avec le message TikTok, ex. spam_risk) si l'upload
 * échoue → permet la bascule de compte en amont. Renvoie l'URL du post sinon.
 */
async function pollUploadStatus(
  apiKey: string,
  requestId: string,
  onNote?: (m: string) => void
): Promise<{ url: string | null; postId: string | null }> {
  const url = `https://api.upload-post.com/api/uploadposts/status?request_id=${encodeURIComponent(requestId)}`
  for (let i = 0; i < 40; i++) {
    let j: StatusResult | null = null
    try {
      const r = await fetch(url, { headers: { Authorization: `Apikey ${apiKey}` } })
      j = (await r.json()) as StatusResult
    } catch {
      /* réseau : on réessaie */
    }
    // On n'évalue le résultat QUE lorsque le traitement est terminé : pendant
    // « processing », results[].success vaut false par défaut → sinon faux échec.
    if (j && (j.status === 'completed' || j.status === 'failed')) {
      const tk = (j.results ?? []).find((x) => x.platform === 'tiktok') ?? j.results?.[0]
      if (tk?.success === true) return { url: tk.post_url ?? null, postId: tk.platform_post_id ?? postIdFromUrl(tk.post_url) }
      // ⚠️ Un faux échec coûte TRÈS cher : l'appelant régénère et REPUBLIE une vidéo
      // déjà en ligne (doublon sur le compte). On ne conclut donc à l'échec que sur
      // preuve EXPLICITE — `success: false`, ou un statut « failed ».
      if (tk?.success === false || j.status === 'failed') {
        throw new Error(`upload-post : ${tk?.error_message || 'échec de la publication'}`)
      }
      // « completed » sans résultat exploitable (results absent/vide/autre forme) :
      // le traitement s'est terminé sans erreur → la vidéo est très probablement en
      // ligne. On considère soumis, sans URL, plutôt que de risquer un doublon.
      onNote?.(`upload-post : statut « completed » sans résultat TikTok exploitable — considéré publié. Réponse : ${JSON.stringify(j).slice(0, 300)}`)
      return { url: null, postId: null }
    }
    await sleep(3000)
  }
  // Toujours en cours après le délai max : considéré soumis (pas de faux échec).
  onNote?.(`upload-post : toujours « processing » après ${(40 * 3000) / 1000}s — considéré soumis (request_id ${requestId}).`)
  return { url: null, postId: null }
}

export interface UploadPostProfile {
  username: string
  tiktokHandle: string | null
  avatarUrl: string | null
  tiktokConnected: boolean
  reauthRequired: boolean
  blocked: boolean
}

interface RawProfilesResult {
  success?: boolean
  error?: string
  profiles?: Array<{
    username?: string
    blocked?: boolean
    social_accounts?: {
      tiktok?: { handle?: string; display_name?: string; reauth_required?: boolean; social_images?: string }
    }
  }>
}

/** Liste les profils upload-post et l'état de leur compte TikTok connecté. */
export async function listUploadPostProfiles(apiKey: string): Promise<UploadPostProfile[]> {
  if (!apiKey) throw new Error('Clé API upload-post manquante')
  const res = await fetch('https://api.upload-post.com/api/uploadposts/users', {
    headers: { Authorization: `Apikey ${apiKey}` }
  })
  const text = await res.text()
  let json: RawProfilesResult
  try {
    json = JSON.parse(text) as RawProfilesResult
  } catch {
    throw new Error(`upload-post réponse invalide (HTTP ${res.status})`)
  }
  if (!res.ok || json.success === false) {
    throw new Error(`upload-post : ${json.error || `HTTP ${res.status}`}`)
  }
  return (json.profiles ?? [])
    .map((p) => {
      const tk = p.social_accounts?.tiktok
      return {
        username: String(p.username ?? ''),
        tiktokHandle: tk?.handle ?? tk?.display_name ?? null,
        avatarUrl: tk?.social_images ?? null,
        tiktokConnected: !!tk,
        reauthRequired: !!tk?.reauth_required,
        blocked: !!p.blocked
      }
    })
    .filter((p) => p.username)
}
