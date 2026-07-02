import * as repo from '../src/main/db/repo'
import { getEncrypted, setEncrypted } from './secrets'
import {
  refreshToken,
  buildAuthUrl,
  exchangeCode,
  queryCreatorInfo,
  generatePkce,
  type TikTokConfig,
  type TokenSet,
  type CreatorInfo
} from '../src/main/publish/tiktok'
import {
  publishClip,
  type PublishDeps,
  type PublishMode,
  type PublishOverrides
} from '../src/main/publish/index'
import type { AppPaths } from './config'

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
    redirectUri: repo.getSetting(F.ttRedirect) || '',
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

/** Profils upload-post configurés (liste multi-comptes ; repli sur l'ancien champ unique). */
export function uploadPostProfiles(): string[] {
  const raw = repo.getSetting('uploadpost_users')
  if (raw) {
    try {
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr)) {
        const list = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        if (list.length) return list
      }
    } catch {
      /* JSON invalide : on ignore et on retombe sur le champ unique */
    }
  }
  const single = repo.getSetting('uploadpost_user')
  return single ? [single] : []
}

/** Profil TikTok actif (choisi globalement en haut à droite). Repli sur le 1er profil configuré. */
export function activeProfile(): string {
  return (repo.getSetting('active_profile') || uploadPostProfiles()[0] || '').trim()
}

/** Marque le quota journalier « atteint » pour un profil (déclenche la bannière globale). */
function setQuotaReached(profile: string): void {
  if (profile) repo.setSetting(`quota_reached_${profile}`, String(Date.now()))
}
/** Efface l'état « quota atteint » (publication de nouveau possible → la bannière disparaît). */
function clearQuota(profile: string): void {
  if (profile) repo.deleteSetting(`quota_reached_${profile}`)
}

/** Vrai si l'erreur est une saturation TikTok (quota journalier atteint). */
function isRateLimit(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /spam_risk|too many posts|rate.?limit/i.test(m)
}

/** Libellé du « compte » de publication pour les modes hors upload-post (page Publiés). */
function publishedLabelFor(mode: PublishMode): string {
  if (mode === 'export') return 'Export dossier'
  const nick = repo.getSetting('tiktok_nickname')
  return nick ? `@${nick}` : 'TikTok'
}

export function buildPublishDeps(paths: AppPaths): PublishDeps {
  const mode = (repo.getSetting(F.mode) as PublishMode) || 'export'
  return {
    mode,
    exportDir: repo.getSetting(F.exportDir) || paths.uploads,
    getTikTokAccess,
    // upload-post publie en public sans audit → défaut public pour ce mode.
    privacyLevel: repo.getSetting(F.ttPrivacy) || (mode === 'uploadpost' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY'),
    uploadPostKey: getEncrypted('uploadpost_key'),
    uploadPostUser: activeProfile()
  }
}

export function getTikTokAuthUrl(): string {
  const cfg = getTikTokConfig()
  if (!cfg) throw new Error('Configure d’abord la clé client, le secret et le redirect TikTok.')
  const { verifier, challenge } = generatePkce()
  repo.setSetting('tiktok_pkce_verifier', verifier)
  return buildAuthUrl(cfg, 'manual', challenge)
}

export async function submitTikTokCode(codeOrUrl: string): Promise<void> {
  const cfg = getTikTokConfig()
  if (!cfg) throw new Error('Configuration TikTok incomplète.')
  const raw = codeOrUrl.trim()
  let code = raw
  try {
    const u = new URL(raw)
    code = u.searchParams.get('code') ?? raw
  } catch {
    /* pas une URL : code brut */
  }
  if (!code) throw new Error('Code introuvable.')
  const verifier = repo.getSetting('tiktok_pkce_verifier') ?? ''
  saveTikTokTokens(await exchangeCode(cfg, code, verifier))
  repo.deleteSetting('tiktok_pkce_verifier')
  try {
    await checkTikTokCreator()
  } catch {
    /* profil non récupéré : pas bloquant */
  }
}

export async function checkTikTokCreator(): Promise<CreatorInfo> {
  const token = await getTikTokAccess()
  if (!token) throw new Error('TikTok non connecté.')
  const info = await queryCreatorInfo(token)
  storeProfile(info)
  return info
}

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
    const deps = buildPublishDeps(paths)
    // upload-post : on publie sur le PROFIL ACTIF (choisi en haut à droite), ou
    // sur un compte forcé (overrides). Un seul compte, pas de rotation.
    if (deps.mode === 'uploadpost') {
      const target = overrides?.uploadPostUser?.trim() || activeProfile()
      if (!target) throw new Error('Aucun profil TikTok sélectionné')
      deps.uploadPostUser = target
      try {
        const out = await publishClip(clip, deps, overrides)
        repo.updateClip(id, { publishStatus: 'published', publishedAccount: target })
        clearQuota(target) // publication réussie → quota de nouveau OK, bannière masquée
        log?.(`Clip #${id} publié sur « ${target} » — ${out.detail}`)
        return
      } catch (e) {
        if (isRateLimit(e)) setQuotaReached(target) // quota journalier atteint → bannière
        throw e
      }
    }
    const out = await publishClip(clip, deps, overrides)
    repo.updateClip(id, { publishStatus: 'published', publishedAccount: publishedLabelFor(deps.mode) })
    log?.(`Clip #${id} publié — ${out.detail}`)
  } catch (e) {
    repo.setClipPublish(id, 'failed')
    const msg = e instanceof Error ? e.message : String(e)
    log?.(`Clip #${id} échec publication — ${msg}`)
    throw e
  }
}
