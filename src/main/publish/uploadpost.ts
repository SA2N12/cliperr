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
}

interface UploadPostResult {
  success?: boolean
  error?: string
  request_id?: string
  results?: { tiktok?: { success?: boolean; url?: string; error?: string } }
}

/** Poste un clip sur TikTok via upload-post. Renvoie l'URL du post si dispo. */
export async function uploadPostTikTok(p: UploadPostParams): Promise<{ url: string | null }> {
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
      throw new Error(`upload-post : ${tt.error || json.error || `HTTP ${res.status}`}`)
    }
    return { url: tt.url ?? null }
  }
  // Cas asynchrone : traité en tâche de fond → on suit le statut jusqu'au résultat réel.
  if (res.ok && json.success && json.request_id) {
    return pollUploadStatus(p.apiKey, json.request_id)
  }
  throw new Error(`upload-post : ${json.error || `HTTP ${res.status}`}`)
}

interface StatusResult {
  status?: string
  results?: Array<{ platform?: string; success?: boolean; post_url?: string; error_message?: string }>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Suit un upload asynchrone via GET /api/uploadposts/status jusqu'à son issue
 * réelle. Lève une erreur (avec le message TikTok, ex. spam_risk) si l'upload
 * échoue → permet la bascule de compte en amont. Renvoie l'URL du post sinon.
 */
async function pollUploadStatus(apiKey: string, requestId: string): Promise<{ url: string | null }> {
  const url = `https://api.upload-post.com/api/uploadposts/status?request_id=${encodeURIComponent(requestId)}`
  for (let i = 0; i < 20; i++) {
    let j: StatusResult | null = null
    try {
      const r = await fetch(url, { headers: { Authorization: `Apikey ${apiKey}` } })
      j = (await r.json()) as StatusResult
    } catch {
      /* réseau : on réessaie */
    }
    if (j) {
      const tk = (j.results ?? []).find((x) => x.platform === 'tiktok') ?? j.results?.[0]
      if (tk) {
        if (tk.success === false) {
          throw new Error(`upload-post : ${tk.error_message || 'échec de la publication'}`)
        }
        return { url: tk.post_url ?? null }
      }
      if (j.status === 'failed') throw new Error('upload-post : échec de la publication (statut failed)')
    }
    await sleep(3000)
  }
  // Timeout : l'upload est soumis mais pas encore confirmé → on ne fait pas échouer.
  return { url: null }
}

export interface UploadPostProfile {
  username: string
  tiktokHandle: string | null
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
    social_accounts?: { tiktok?: { handle?: string; display_name?: string; reauth_required?: boolean } }
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
        tiktokConnected: !!tk,
        reauthRequired: !!tk?.reauth_required,
        blocked: !!p.blocked
      }
    })
    .filter((p) => p.username)
}
