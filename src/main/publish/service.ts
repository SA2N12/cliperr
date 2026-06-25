import { join } from 'path'
import * as repo from '../db/repo'
import { getEncrypted, setEncrypted } from '../secrets'
import {
  refreshToken,
  buildAuthUrl,
  exchangeCode,
  queryCreatorInfo,
  generatePkce,
  type TikTokConfig,
  type TokenSet,
  type CreatorInfo
} from './tiktok'
import { publishClip, type PublishDeps, type PublishMode, type PublishOverrides } from './index'
import type { AppPaths } from '../paths'

const F = {
  mode: 'publish_mode',
  exportDir: 'export_dir',
  ttClientKey: 'tiktok_client_key',
  ttRedirect: 'tiktok_redirect',
  ttScope: 'tiktok_scope',
  ttPrivacy: 'tiktok_privacy'
}

export function getTikTokConfig(): TikTokConfig | null {
  const clientKey = repo.getSetting(F.ttClientKey)
  const clientSecret = getEncrypted('tiktok_client_secret')
  if (!clientKey || !clientSecret) return null
  return {
    clientKey,
    clientSecret,
    redirectUri: repo.getSetting(F.ttRedirect) || 'http://127.0.0.1:43217/callback',
    scope: repo.getSetting(F.ttScope) || 'video.publish,video.upload'
  }
}

export function saveTikTokTokens(t: TokenSet): void {
  setEncrypted('tiktok_tokens', JSON.stringify(t))
}

export function getTikTokTokens(): TokenSet | null {
  const raw = getEncrypted('tiktok_tokens')
  if (!raw) return null
  try {
    return JSON.parse(raw) as TokenSet
  } catch {
    return null
  }
}

export function clearTikTokTokens(): void {
  setEncrypted('tiktok_tokens', '')
  repo.deleteSetting('tiktok_nickname')
  repo.deleteSetting('tiktok_username')
  repo.deleteSetting('tiktok_avatar')
}

export function tiktokConnected(): boolean {
  return !!getTikTokTokens()
}

export interface TikTokProfile {
  connected: boolean
  nickname: string | null
  username: string | null
  avatarUrl: string | null
}

function storeProfile(info: CreatorInfo): void {
  repo.setSetting('tiktok_nickname', info.nickname ?? '')
  repo.setSetting('tiktok_username', info.username ?? '')
  repo.setSetting('tiktok_avatar', info.avatarUrl ?? '')
}

/** Profil TikTok mis en cache (pour l'en-tête), sans appel réseau. */
export function getTikTokProfile(): TikTokProfile {
  return {
    connected: tiktokConnected(),
    nickname: repo.getSetting('tiktok_nickname') || null,
    username: repo.getSetting('tiktok_username') || null,
    avatarUrl: repo.getSetting('tiktok_avatar') || null
  }
}

async function getTikTokAccess(): Promise<string | null> {
  const tokens = getTikTokTokens()
  if (!tokens) return null
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken
  const cfg = getTikTokConfig()
  if (!cfg || !tokens.refreshToken) return tokens.accessToken
  try {
    const fresh = await refreshToken(cfg, tokens.refreshToken)
    saveTikTokTokens(fresh)
    return fresh.accessToken
  } catch {
    return tokens.accessToken
  }
}

export function buildPublishDeps(paths: AppPaths): PublishDeps {
  return {
    mode: (repo.getSetting(F.mode) as PublishMode) || 'export',
    exportDir: repo.getSetting(F.exportDir) || join(paths.data, 'exports'),
    getTikTokAccess,
    privacyLevel: repo.getSetting(F.ttPrivacy) || 'SELF_ONLY'
  }
}

/** URL d'autorisation TikTok (pour la connexion manuelle par code). Persiste le verifier PKCE. */
export function getTikTokAuthUrl(): string {
  const cfg = getTikTokConfig()
  if (!cfg) throw new Error('Configure d’abord la clé client, le secret et le redirect TikTok.')
  const { verifier, challenge } = generatePkce()
  repo.setSetting('tiktok_pkce_verifier', verifier)
  return buildAuthUrl(cfg, 'manual', challenge)
}

/** Échange un code (brut ou URL de redirection collée) contre des tokens. */
export async function submitTikTokCode(codeOrUrl: string): Promise<void> {
  const cfg = getTikTokConfig()
  if (!cfg) throw new Error('Configuration TikTok incomplète.')
  const raw = codeOrUrl.trim()
  let code = raw
  try {
    const u = new URL(raw)
    code = u.searchParams.get('code') ?? raw
  } catch {
    /* ce n'était pas une URL : on garde le code brut */
  }
  if (!code) throw new Error('Code introuvable.')
  const verifier = repo.getSetting('tiktok_pkce_verifier') ?? ''
  saveTikTokTokens(await exchangeCode(cfg, code, verifier))
  repo.deleteSetting('tiktok_pkce_verifier')
  // Récupère pseudo + avatar pour l'en-tête (sans bloquer la connexion en cas d'échec).
  try {
    await checkTikTokCreator()
  } catch {
    /* profil non récupéré : pas bloquant */
  }
}

/** Diagnostic : confirme la connexion + niveaux de confidentialité autorisés. */
export async function checkTikTokCreator(): Promise<CreatorInfo> {
  const token = await getTikTokAccess()
  if (!token) throw new Error('TikTok non connecté.')
  const info = await queryCreatorInfo(token)
  storeProfile(info)
  return info
}

/** Publie un clip par id, met à jour son statut, journalise. */
export async function publishClipById(
  id: number,
  paths: AppPaths,
  log?: (m: string) => void,
  overrides?: PublishOverrides
): Promise<void> {
  const clip = repo.getClip(id)
  if (!clip) throw new Error(`Clip #${id} introuvable`)
  repo.setClipPublish(id, 'scheduled')
  try {
    const out = await publishClip(clip, buildPublishDeps(paths), overrides)
    repo.setClipPublish(id, 'published')
    log?.(`Clip #${id} publié — ${out.detail}`)
  } catch (e) {
    repo.setClipPublish(id, 'failed')
    const msg = e instanceof Error ? e.message : String(e)
    log?.(`Clip #${id} échec publication — ${msg}`)
    throw e
  }
}
