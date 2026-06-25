import { readFile, stat } from 'node:fs/promises'
import { randomBytes, createHash } from 'node:crypto'

// ⚠️ La Content Posting API de TikTok nécessite une app développeur APPROUVÉE
// (scopes video.publish / video.upload). Tant que l'app n'est pas auditée, seul
// le mode privé (SELF_ONLY) fonctionne. Ce module est implémenté mais ne peut
// pas être validé sans une vraie app + un vrai compte.

export interface TikTokConfig {
  clientKey: string
  clientSecret: string
  redirectUri: string // ex: http://127.0.0.1:43217/callback (à enregistrer côté TikTok)
  scope?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // ms epoch
  openId: string
  scope: string
}

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
const INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'
const CREATOR_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/'

// PKCE (requis par TikTok). TikTok attend un code_challenge = SHA256(verifier)
// encodé en HEX (et non en base64url comme le standard RFC 7636).
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const challenge = createHash('sha256').update(verifier).digest('hex')
  return { verifier, challenge }
}

export function buildAuthUrl(cfg: TikTokConfig, state: string, codeChallenge: string): string {
  const u = new URL(AUTH_BASE)
  u.searchParams.set('client_key', cfg.clientKey)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', cfg.scope ?? 'video.publish')
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', codeChallenge)
  return u.toString()
}

export async function exchangeCode(
  cfg: TikTokConfig,
  code: string,
  codeVerifier: string
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const j = (await res.json()) as Record<string, unknown>
  if (!res.ok || !j.access_token) throw new Error(`Échange du code échoué : ${JSON.stringify(j)}`)
  return {
    accessToken: String(j.access_token),
    refreshToken: String(j.refresh_token ?? ''),
    expiresAt: Date.now() + Number(j.expires_in ?? 0) * 1000,
    openId: String(j.open_id ?? ''),
    scope: String(j.scope ?? cfg.scope ?? '')
  }
}

export async function refreshToken(cfg: TikTokConfig, refresh: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const j = (await res.json()) as Record<string, unknown>
  if (!res.ok || !j.access_token) throw new Error(`Rafraîchissement échoué : ${JSON.stringify(j)}`)
  return {
    accessToken: String(j.access_token),
    refreshToken: String(j.refresh_token ?? refresh),
    expiresAt: Date.now() + Number(j.expires_in ?? 0) * 1000,
    openId: String(j.open_id ?? ''),
    scope: String(j.scope ?? cfg.scope ?? '')
  }
}

export interface PublishResult {
  publishId: string
  status: string
}

/** Direct Post : init → upload du fichier → renvoie l'identifiant de publication. */
export async function publishVideo(opts: {
  accessToken: string
  filePath: string
  caption: string
  privacyLevel?: string
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  brandOrganic?: boolean
  brandContent?: boolean
}): Promise<PublishResult> {
  const size = (await stat(opts.filePath)).size
  const initRes = await fetch(INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      post_info: {
        title: opts.caption.slice(0, 2200),
        privacy_level: opts.privacyLevel ?? 'SELF_ONLY',
        disable_comment: !!opts.disableComment,
        disable_duet: !!opts.disableDuet,
        disable_stitch: !!opts.disableStitch,
        ...(opts.brandOrganic || opts.brandContent
          ? { brand_organic_toggle: !!opts.brandOrganic, brand_content_toggle: !!opts.brandContent }
          : {})
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1
      }
    })
  })
  const initJson = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string }
    error?: unknown
  }
  const uploadUrl = initJson.data?.upload_url
  const publishId = initJson.data?.publish_id
  if (!initRes.ok || !uploadUrl || !publishId) {
    throw new Error(`Init publication échouée : ${JSON.stringify(initJson)}`)
  }

  const bytes = await readFile(opts.filePath)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`
    },
    body: bytes
  })
  if (!putRes.ok) throw new Error(`Upload échoué : HTTP ${putRes.status}`)

  // Statut (best-effort)
  let status = 'PROCESSING'
  try {
    const st = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({ publish_id: publishId })
    })
    const sj = (await st.json()) as { data?: { status?: string } }
    if (sj.data?.status) status = sj.data.status
  } catch {
    /* ignore */
  }
  return { publishId, status }
}

/**
 * Upload vers les BROUILLONS TikTok (scope video.upload). Pas de post_info :
 * l'utilisateur finalise le post (légende, confidentialité publique) dans l'app
 * TikTok. Fonctionne sans audit. Renvoie l'identifiant de publication.
 */
export async function uploadToInbox(opts: {
  accessToken: string
  filePath: string
}): Promise<{ publishId: string }> {
  const size = (await stat(opts.filePath)).size
  const initRes = await fetch(INBOX_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1
      }
    })
  })
  const initJson = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string }
  }
  const uploadUrl = initJson.data?.upload_url
  const publishId = initJson.data?.publish_id
  if (!initRes.ok || !uploadUrl || !publishId) {
    throw new Error(`Init brouillon échouée : ${JSON.stringify(initJson)}`)
  }

  const bytes = await readFile(opts.filePath)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`
    },
    body: bytes
  })
  if (!putRes.ok) throw new Error(`Upload brouillon échoué : HTTP ${putRes.status}`)
  return { publishId }
}

export interface CreatorInfo {
  nickname: string | null
  username: string | null
  avatarUrl: string | null
  privacyOptions: string[]
  maxDurationSec: number | null
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
}

/** Interroge l'API creator_info : confirme la connexion + pseudo/avatar + niveaux de confidentialité. */
export async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await fetch(CREATOR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: '{}'
  })
  const j = (await res.json()) as {
    data?: {
      creator_nickname?: string
      creator_username?: string
      creator_avatar_url?: string
      privacy_level_options?: string[]
      max_video_post_duration_sec?: number
      comment_disabled?: boolean
      duet_disabled?: boolean
      stitch_disabled?: boolean
    }
    error?: { message?: string; code?: string }
  }
  if (!res.ok || (j.error && j.error.code && j.error.code !== 'ok')) {
    throw new Error(`creator_info : ${j.error?.message ?? `HTTP ${res.status}`}`)
  }
  return {
    nickname: j.data?.creator_nickname ?? null,
    username: j.data?.creator_username ?? null,
    avatarUrl: j.data?.creator_avatar_url ?? null,
    privacyOptions: j.data?.privacy_level_options ?? [],
    maxDurationSec: j.data?.max_video_post_duration_sec ?? null,
    commentDisabled: !!j.data?.comment_disabled,
    duetDisabled: !!j.data?.duet_disabled,
    stitchDisabled: !!j.data?.stitch_disabled
  }
}
