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

/** Valeur spéciale « Tous les comptes » du sélecteur en haut à droite. */
export const ALL_SCOPE = '__all__'

/** Portée d'affichage choisie en haut à droite : un profil précis ou « __all__ ». */
export function activeScope(): string {
  const s = (repo.getSetting('active_profile') || '').trim()
  return s || (uploadPostProfiles()[0] || '')
}

/** Profil TikTok concret pour publier. « Tous » → 1er profil configuré par défaut. */
export function activeProfile(): string {
  const s = (repo.getSetting('active_profile') || '').trim()
  if (s && s !== ALL_SCOPE) return s
  return (uploadPostProfiles()[0] || '').trim()
}

/** CTA (« appel à l'action » + lien en bio) configuré par profil ET par type de vidéo,
 *  ajouté aux légendes. Ancien format (une seule chaîne par profil) = même CTA partout. */
export type CtaMap = { niche?: string; serie?: string; custom?: string; clip?: string }
const CTA_TYPES = ['niche', 'serie', 'custom', 'clip'] as const
export function profileCtas(): Record<string, string | CtaMap> {
  try {
    const raw = repo.getSetting('profile_ctas')
    if (raw) {
      const o = JSON.parse(raw) as unknown
      if (o && typeof o === 'object') return o as Record<string, string | CtaMap>
    }
  } catch {
    /* JSON invalide → vide */
  }
  return {}
}
/** CTA à utiliser pour une vidéo d'un TYPE donné (niche par défaut). */
export function ctaForProfile(user: string, type?: string): string {
  const raw = profileCtas()[user]
  if (typeof raw === 'string') return raw.trim() // ancien format : même CTA pour tous les types
  if (raw && typeof raw === 'object') {
    const t = (type && (CTA_TYPES as readonly string[]).includes(type) ? type : 'niche') as keyof CtaMap
    return String(raw[t] ?? '').trim()
  }
  return ''
}
/** Les 4 CTA d'un compte (pour l'UI) — migre l'ancien format string → appliqué à tous. */
export function ctaMapForProfile(user: string): CtaMap {
  const raw = profileCtas()[user]
  if (typeof raw === 'string') { const s = raw.trim(); return { niche: s, serie: s, custom: s, clip: s } }
  if (raw && typeof raw === 'object') {
    return { niche: String(raw.niche ?? '').trim(), serie: String(raw.serie ?? '').trim(), custom: String(raw.custom ?? '').trim(), clip: String(raw.clip ?? '').trim() }
  }
  return {}
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
    deps.onNote = log // trace les réponses ambiguës d'upload-post dans le journal
    // upload-post : on publie sur le PROFIL ACTIF (choisi en haut à droite), ou
    // sur un compte forcé (overrides). Un seul compte, pas de rotation.
    if (deps.mode === 'uploadpost') {
      const target = overrides?.uploadPostUser?.trim() || activeProfile()
      if (!target) throw new Error('Aucun profil TikTok sélectionné')
      deps.uploadPostUser = target
      // CTA du compte, choisi selon le TYPE de la vidéo (niche/série/sujet/clip),
      // ajouté automatiquement à la légende.
      let effective = overrides
      const cta = ctaForProfile(target, overrides?.videoType)
      if (cta) {
        const manual = overrides?.caption?.trim()
        if (manual) {
          // Légende saisie à la main : on ajoute le CTA à la fin (sans doublon).
          if (!manual.includes(cta)) effective = { ...overrides, caption: `${manual}\n\n${cta}` }
        } else {
          // Légende auto : description → CTA → hashtags (CTA visible avant les tags).
          const body = clip.description || clip.title || ''
          const caption = [body, cta, clip.hashtags || ''].map((s) => s.trim()).filter(Boolean).join('\n\n')
          effective = { ...overrides, caption }
        }
      }
      try {
        const out = await publishClip(clip, deps, effective)
        repo.updateClip(id, { publishStatus: 'published', publishedAccount: target, postUrl: out.postUrl ?? null, postId: out.postId ?? null })
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
