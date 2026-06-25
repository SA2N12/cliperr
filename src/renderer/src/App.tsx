import { useEffect, useState, useCallback, useMemo } from 'react'
import type { SourceDTO, ClipDTO, ProgressEvent } from '@shared/types'

const FLAG_TRANSCRIBE = 'transcribe_enabled'
const FLAG_MODEL = 'highlights_model'

const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku 4.5 — le moins cher (~0,01 $/vidéo)' },
  { value: 'sonnet', label: 'Sonnet 4.6 — équilibré (~0,03 $/vidéo)' },
  { value: 'opus', label: 'Opus 4.8 — le plus malin (~0,05–0,10 $/vidéo)' }
]

const CRON_OPTIONS = [
  { value: '*/5 * * * *', label: 'Toutes les 5 min' },
  { value: '*/15 * * * *', label: 'Toutes les 15 min' },
  { value: '*/30 * * * *', label: 'Toutes les 30 min' },
  { value: '0 * * * *', label: 'Toutes les heures' },
  { value: '0 */3 * * *', label: 'Toutes les 3 h' },
  { value: '0 9,17 * * *', label: 'Chaque jour à 9h et 17h' }
]

function clipUrl(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return `clipmedia://clips/${encodeURIComponent(base)}`
}

function privacyLabel(o: string): string {
  switch (o) {
    case 'PUBLIC_TO_EVERYONE':
      return 'Public (Tout le monde)'
    case 'MUTUAL_FOLLOW_FRIENDS':
      return 'Amis (abonnés mutuels)'
    case 'FOLLOWER_OF_CREATOR':
      return 'Abonnés'
    case 'SELF_ONLY':
      return 'Privé (Seulement moi)'
    default:
      return o
  }
}

interface PubModalState {
  clip: ClipDTO
  caption: string
  privacy: string
  privacyOptions: string[]
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  commercial: boolean
  brandOrganic: boolean
  brandContent: boolean
  nickname: string | null
  loading: boolean
  publishing: boolean
}

export default function App(): JSX.Element {
  const [versions, setVersions] = useState<{ node: string; electron: string; chrome: string } | null>(
    null
  )
  const [url, setUrl] = useState('')
  const [sources, setSources] = useState<SourceDTO[]>([])
  const [clipsBySource, setClipsBySource] = useState<Record<number, ClipDTO[]>>({})
  const [clipCounts, setClipCounts] = useState<Record<number, number>>({})
  const [pubModal, setPubModal] = useState<PubModalState | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [view, setView] = useState<'sources' | 'clips'>('sources')

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [transcribe, setTranscribe] = useState(false)
  const [model, setModel] = useState('haiku')
  const [reframeFocus, setReframeFocus] = useState('center')
  const [transcribeBackend, setTranscribeBackend] = useState('local')
  const [hasGroqKey, setHasGroqKey] = useState(false)
  const [groqInput, setGroqInput] = useState('')
  const [cookiesBrowser, setCookiesBrowser] = useState('')
  const [cookiesFile, setCookiesFile] = useState('')
  const [conn, setConn] = useState<{ connected: boolean; masked: string | null; error?: string } | null>(
    null
  )
  const [spend, setSpend] = useState<{ usd: number; inTokens: number; outTokens: number } | null>(null)
  const [checking, setChecking] = useState(false)

  // Publication & planification
  const [pubMode, setPubMode] = useState<'export' | 'tiktok' | 'tiktok_draft'>('export')
  const [exportDir, setExportDir] = useState('')
  const [schedEnabled, setSchedEnabled] = useState(false)
  const [schedCron, setSchedCron] = useState('*/30 * * * *')
  const [ttKey, setTtKey] = useState('')
  const [ttRedirect, setTtRedirect] = useState('http://127.0.0.1:43217/callback')
  const [ttSecret, setTtSecret] = useState('')
  const [ttStatus, setTtStatus] = useState<{ connected: boolean; hasConfig: boolean; hasSecret: boolean } | null>(
    null
  )
  const [ttPrivacy, setTtPrivacy] = useState('SELF_ONLY')
  const [ttCode, setTtCode] = useState('')
  const [ttCreator, setTtCreator] = useState<string | null>(null)
  const [ttProfile, setTtProfile] = useState<{
    connected: boolean
    nickname: string | null
    username: string | null
    avatarUrl: string | null
  } | null>(null)

  const pushLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 300))
  }, [])

  const refreshAccount = useCallback(async () => {
    setChecking(true)
    try {
      const [c, s] = await Promise.all([window.api.validateKey(), window.api.getSpend()])
      setConn(c)
      setSpend(s)
    } catch {
      /* ignore */
    } finally {
      setChecking(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [srcs, clips] = await Promise.all([window.api.listSources(), window.api.listClips()])
      setSources(srcs)
      const grouped: Record<number, ClipDTO[]> = {}
      for (const c of clips) (grouped[c.sourceId] ??= []).push(c)
      setClipsBySource(grouped)
    } catch {
      /* handlers pas encore prêts */
    }
  }, [])

  useEffect(() => {
    window.api.getVersions().then(setVersions).catch(() => undefined)
    window.api.hasApiKey().then(setHasKey).catch(() => undefined)
    window.api
      .getFlag(FLAG_TRANSCRIBE)
      .then((v) => setTranscribe(v === '1'))
      .catch(() => undefined)
    window.api
      .getFlag(FLAG_MODEL)
      .then((v) => v && setModel(v))
      .catch(() => undefined)
    window.api
      .getFlag('reframe_focus')
      .then((v) => v && setReframeFocus(v))
      .catch(() => undefined)
    window.api
      .getFlag('transcribe_backend')
      .then((v) => v && setTranscribeBackend(v))
      .catch(() => undefined)
    window.api.hasGroqKey().then(setHasGroqKey).catch(() => undefined)
    window.api
      .getFlag('ytdlp_cookies_browser')
      .then((v) => v && setCookiesBrowser(v))
      .catch(() => undefined)
    window.api
      .getFlag('ytdlp_cookies_file')
      .then((v) => v && setCookiesFile(v))
      .catch(() => undefined)
    window.api
      .getFlag('publish_mode')
      .then((v) => {
        if (v === 'tiktok' || v === 'tiktok_draft' || v === 'export') setPubMode(v)
      })
      .catch(() => undefined)
    window.api.getFlag('export_dir').then((v) => v && setExportDir(v)).catch(() => undefined)
    window.api.getFlag('schedule_enabled').then((v) => setSchedEnabled(v === '1')).catch(() => undefined)
    window.api.getFlag('schedule_cron').then((v) => v && setSchedCron(v)).catch(() => undefined)
    window.api.getFlag('tiktok_client_key').then((v) => v && setTtKey(v)).catch(() => undefined)
    window.api.getFlag('tiktok_redirect').then((v) => v && setTtRedirect(v)).catch(() => undefined)
    window.api.getFlag('tiktok_privacy').then((v) => v && setTtPrivacy(v)).catch(() => undefined)
    window.api.tiktokStatus().then(setTtStatus).catch(() => undefined)
    window.api.tiktokGetProfile().then(setTtProfile).catch(() => undefined)

    refresh()
    refreshAccount()
    const off = window.api.onProgress((e: ProgressEvent) => {
      pushLog(
        `[${e.stage}] ${e.status} ${(e.progress * 100).toFixed(0)}%${e.message ? ' — ' + e.message : ''}`
      )
      if (e.status === 'done' || e.status === 'error') {
        refresh()
        if (e.stage === 'highlights' && e.status === 'done') window.api.getSpend().then(setSpend)
      }
    })
    const offPub = window.api.onPublishLog((m) => {
      pushLog(`📤 ${m}`)
      refresh()
    })
    return () => {
      off()
      offPub()
    }
  }, [refresh, refreshAccount, pushLog])

  async function addSource(): Promise<void> {
    if (!url.trim()) return
    setBusy(true)
    try {
      const src = await window.api.addSource(url.trim())
      pushLog(`Source ajoutée #${src.id}`)
      setUrl('')
      await refresh()
    } catch (err) {
      pushLog(`Erreur ajout source: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // Importer un fichier vidéo local (saute le téléchargement YouTube → pas d'anti-bot).
  async function importFile(): Promise<void> {
    const path = await window.api.pickVideo()
    if (!path) return
    setBusy(true)
    try {
      const src = await window.api.addSource(path)
      pushLog(`Fichier importé comme source #${src.id}`)
      await refresh()
    } catch (err) {
      pushLog(`Erreur import fichier: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function runPipeline(id: number): Promise<void> {
    const n = clipCounts[id] ?? 3
    pushLog(`Pipeline lancé pour la source #${id} (${n} clip${n > 1 ? 's' : ''})`)
    try {
      await window.api.runPipeline(id, n)
    } catch (err) {
      pushLog(`Erreur pipeline: ${String(err)}`)
    }
  }

  async function saveKey(): Promise<void> {
    await window.api.setApiKey(keyInput)
    setKeyInput('')
    setHasKey(await window.api.hasApiKey())
    pushLog('Clé API enregistrée — vérification…')
    await refreshAccount()
  }

  async function clearKey(): Promise<void> {
    await window.api.clearApiKey()
    setHasKey(false)
    pushLog('Clé API supprimée')
    await refreshAccount()
  }

  async function resetSpend(): Promise<void> {
    await window.api.resetSpend()
    setSpend(await window.api.getSpend())
  }

  async function copyCaption(c: ClipDTO): Promise<void> {
    const caption = [c.description, c.hashtags].filter(Boolean).join('\n\n')
    if (!caption) return
    await navigator.clipboard.writeText(caption)
    pushLog(`Légende copiée (clip #${c.id})`)
  }

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])),
    [sources]
  )
  const allClips = useMemo(
    () => Object.values(clipsBySource).flat().sort((a, b) => b.createdAt - a.createdAt),
    [clipsBySource]
  )

  async function review(id: number, status: ClipDTO['reviewStatus']): Promise<void> {
    await window.api.reviewClip(id, status)
    await refresh()
  }

  async function publishOne(id: number): Promise<void> {
    pushLog(`Publication du clip #${id}…`)
    try {
      await window.api.publishClip(id)
    } catch (err) {
      pushLog(`Erreur publication: ${String(err)}`)
    }
    await refresh()
  }

  // Point d'entrée du bouton « Publier » : export → direct ; TikTok → écran de confirmation.
  function startPublish(c: ClipDTO): void {
    if (
      c.publishStatus === 'published' &&
      !window.confirm(
        'Ce clip a déjà été publié. Le republier créera un NOUVEAU post/brouillon sur TikTok — pense à supprimer l’ancien pour éviter les doublons. Continuer ?'
      )
    )
      return
    if (pubMode === 'export') {
      publishOne(c.id)
      return
    }
    openPublishModal(c)
  }

  async function openPublishModal(c: ClipDTO): Promise<void> {
    setPubModal({
      clip: c,
      caption: [c.description, c.hashtags].filter(Boolean).join(' '),
      privacy: 'SELF_ONLY',
      privacyOptions: [],
      allowComment: true,
      allowDuet: true,
      allowStitch: true,
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      commercial: false,
      brandOrganic: false,
      brandContent: false,
      nickname: ttProfile?.nickname ?? null,
      loading: true,
      publishing: false
    })
    try {
      const info = await window.api.tiktokCheckCreator()
      setPubModal((m) =>
        m
          ? {
              ...m,
              loading: false,
              nickname: info.nickname ?? m.nickname,
              privacyOptions: info.privacyOptions,
              privacy: info.privacyOptions[0] ?? 'SELF_ONLY',
              commentDisabled: info.commentDisabled,
              duetDisabled: info.duetDisabled,
              stitchDisabled: info.stitchDisabled,
              allowComment: !info.commentDisabled,
              allowDuet: !info.duetDisabled,
              allowStitch: !info.stitchDisabled
            }
          : m
      )
    } catch (err) {
      pushLog(`creator_info indisponible: ${String(err)}`)
      setPubModal((m) => (m ? { ...m, loading: false, privacyOptions: ['SELF_ONLY'] } : m))
    }
  }

  async function confirmPublish(): Promise<void> {
    if (!pubModal) return
    const p = pubModal
    setPubModal({ ...p, publishing: true })
    pushLog(`Publication du clip #${p.clip.id}…`)
    try {
      await window.api.publishClip(p.clip.id, {
        caption: p.caption,
        privacyLevel: p.privacy,
        disableComment: !p.allowComment,
        disableDuet: !p.allowDuet,
        disableStitch: !p.allowStitch,
        brandOrganic: p.commercial && p.brandOrganic,
        brandContent: p.commercial && p.brandContent
      })
    } catch (err) {
      pushLog(`Erreur publication: ${String(err)}`)
    }
    setPubModal(null)
    await refresh()
  }

  async function changePubMode(v: 'export' | 'tiktok' | 'tiktok_draft'): Promise<void> {
    setPubMode(v)
    await window.api.setFlag('publish_mode', v)
  }

  async function pickExportDir(): Promise<void> {
    const dir = await window.api.pickFolder()
    if (dir) {
      setExportDir(dir)
      await window.api.setFlag('export_dir', dir)
    }
  }

  async function toggleSched(v: boolean): Promise<void> {
    setSchedEnabled(v)
    await window.api.setFlag('schedule_enabled', v ? '1' : '0')
    await window.api.reloadScheduler()
  }

  async function changeCron(v: string): Promise<void> {
    setSchedCron(v)
    await window.api.setFlag('schedule_cron', v)
    if (schedEnabled) await window.api.reloadScheduler()
  }

  async function saveTikTokConfig(): Promise<void> {
    await window.api.setFlag('tiktok_client_key', ttKey.trim())
    await window.api.setFlag('tiktok_redirect', ttRedirect.trim())
    if (ttSecret.trim()) {
      await window.api.tiktokSetClientSecret(ttSecret.trim())
      setTtSecret('')
    }
    setTtStatus(await window.api.tiktokStatus())
    pushLog('Config TikTok enregistrée')
  }

  async function tiktokDisconnect(): Promise<void> {
    await window.api.tiktokDisconnect()
    setTtStatus(await window.api.tiktokStatus())
    setTtProfile(await window.api.tiktokGetProfile())
    setTtCreator(null)
  }

  async function changePrivacy(v: string): Promise<void> {
    setTtPrivacy(v)
    await window.api.setFlag('tiktok_privacy', v)
  }

  async function openAuthUrl(): Promise<void> {
    try {
      const url = await window.api.tiktokGetAuthUrl()
      await window.api.openExternal(url)
      pushLog('Page d’autorisation TikTok ouverte — autorise puis copie le code.')
    } catch (err) {
      pushLog(`Erreur: ${String(err)}`)
    }
  }

  async function submitCode(): Promise<void> {
    if (!ttCode.trim()) return
    try {
      await window.api.tiktokSubmitCode(ttCode.trim())
      setTtCode('')
      setTtStatus(await window.api.tiktokStatus())
      setTtProfile(await window.api.tiktokGetProfile())
      pushLog('TikTok connecté (code) ✓')
    } catch (err) {
      pushLog(`Erreur code: ${String(err)}`)
    }
  }

  async function checkCreator(): Promise<void> {
    try {
      const c = await window.api.tiktokCheckCreator()
      setTtCreator(
        `${c.nickname ?? 'compte'} — confidentialité dispo : ${c.privacyOptions.join(', ') || 'n/a'}`
      )
      setTtProfile(await window.api.tiktokGetProfile())
      pushLog('Compte TikTok vérifié ✓')
    } catch (err) {
      setTtCreator(null)
      pushLog(`Erreur vérif: ${String(err)}`)
    }
  }

  async function toggleTranscribe(v: boolean): Promise<void> {
    setTranscribe(v)
    await window.api.setFlag(FLAG_TRANSCRIBE, v ? '1' : '0')
  }

  async function changeModel(v: string): Promise<void> {
    setModel(v)
    await window.api.setFlag(FLAG_MODEL, v)
  }

  async function changeReframe(v: string): Promise<void> {
    setReframeFocus(v)
    await window.api.setFlag('reframe_focus', v)
  }

  async function changeBackend(v: string): Promise<void> {
    setTranscribeBackend(v)
    await window.api.setFlag('transcribe_backend', v)
  }

  async function changeCookies(v: string): Promise<void> {
    setCookiesBrowser(v)
    await window.api.setFlag('ytdlp_cookies_browser', v)
  }

  async function pickCookiesFile(): Promise<void> {
    const f = await window.api.pickFile()
    if (f) {
      setCookiesFile(f)
      await window.api.setFlag('ytdlp_cookies_file', f)
    }
  }

  async function clearCookiesFile(): Promise<void> {
    setCookiesFile('')
    await window.api.setFlag('ytdlp_cookies_file', '')
  }

  async function doUpdateYtDlp(): Promise<void> {
    pushLog('Mise à jour de yt-dlp en cours…')
    try {
      await window.api.updateYtDlp()
    } catch (err) {
      pushLog(`Erreur maj yt-dlp: ${String(err)}`)
    }
  }

  async function doInstallPot(): Promise<void> {
    pushLog('Installation du plugin PO token…')
    try {
      await window.api.installPotPlugin()
    } catch (err) {
      pushLog(`Erreur plugin PO token: ${String(err)}`)
    }
  }

  async function saveGroqKey(): Promise<void> {
    await window.api.setGroqKey(groqInput.trim())
    setGroqInput('')
    setHasGroqKey(await window.api.hasGroqKey())
    pushLog('Clé Groq enregistrée')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}
      >
        <strong style={{ fontSize: 18 }}>
          TikTok<span style={{ color: 'var(--accent)' }}>Clip</span>
        </strong>
        <span style={{ color: 'var(--muted)', fontSize: 12, flex: 1 }}>
          {versions
            ? `Electron ${versions.electron} · Node ${versions.node} · Chrome ${versions.chrome}`
            : 'connexion…'}
        </span>
        {ttProfile?.connected && (
          <span
            title="Compte TikTok connecté"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px 4px 4px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              fontSize: 13
            }}
          >
            {ttProfile.avatarUrl ? (
              <img
                src={ttProfile.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: '#fff'
                }}
              >
                ♪
              </span>
            )}
            <span>
              {ttProfile.username
                ? `@${ttProfile.username}`
                : ttProfile.nickname || 'TikTok'}
            </span>
          </span>
        )}
        <button
          className={view === 'sources' ? 'primary' : ''}
          onClick={() => setView('sources')}
        >
          Sources
        </button>
        <button className={view === 'clips' ? 'primary' : ''} onClick={() => setView('clips')}>
          Clips ({allClips.length})
        </button>
        <button onClick={() => window.api.openClipsFolder()}>Ouvrir le dossier clips</button>
        <button onClick={() => setSettingsOpen((s) => !s)}>Réglages</button>
      </header>

      {settingsOpen && (
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 12,
              padding: 10,
              borderRadius: 8,
              background: 'var(--panel-2)',
              border: '1px solid var(--border)'
            }}
          >
            <span>
              {conn?.connected ? (
                <span style={{ color: '#46d369' }}>● Clé connectée &amp; valide</span>
              ) : conn?.masked ? (
                <span style={{ color: 'var(--accent)' }}>● Clé invalide</span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>○ Aucune clé</span>
              )}
              {conn?.masked && (
                <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                  {conn.masked}
                </span>
              )}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Dépense estimée dans l'app :{' '}
              <strong style={{ color: 'var(--text)' }}>
                ${spend ? spend.usd.toFixed(4) : '0.0000'}
              </strong>
              {spend && spend.inTokens > 0 && (
                <span style={{ fontSize: 11 }}>
                  {' '}
                  ({spend.inTokens.toLocaleString()} in / {spend.outTokens.toLocaleString()} out)
                </span>
              )}
            </span>
            <button onClick={refreshAccount} disabled={checking}>
              {checking ? 'Vérification…' : 'Revérifier'}
            </button>
            <button onClick={resetSpend}>Réinitialiser le compteur</button>
            <a
              onClick={() => window.api.openExternal('https://console.anthropic.com/settings/billing')}
              style={{ cursor: 'pointer', fontSize: 13 }}
            >
              Voir le solde réel ↗
            </a>
          </div>
          {conn && !conn.connected && conn.masked && conn.error && (
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 10 }}>
              {conn.error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input
              type="text"
              placeholder={hasKey ? 'Clé API configurée ✓ (saisir pour remplacer)' : 'Clé API Anthropic (sk-ant-…)'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              style={{ maxWidth: 480 }}
            />
            <button className="primary" onClick={saveKey} disabled={!keyInput.trim()}>
              Enregistrer
            </button>
            {hasKey && <button onClick={clearKey}>Supprimer</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Modèle IA (sélection des moments) :</span>
            <select
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              style={{
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px'
              }}
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={transcribe}
              onChange={(e) => toggleTranscribe(e.target.checked)}
            />
            Activer la transcription + sous-titres
          </label>

          {transcribe && (
            <div style={{ marginTop: 10, paddingLeft: 26 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Moteur :</span>
                <select
                  value={transcribeBackend}
                  onChange={(e) => changeBackend(e.target.value)}
                  style={{
                    background: 'var(--panel-2)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '7px 10px'
                  }}
                >
                  <option value="local">Local — whisper.cpp (gratuit, ~150 Mo, plus lent)</option>
                  <option value="groq">Cloud Groq (ultra rapide, clé requise)</option>
                </select>
              </div>
              {transcribeBackend === 'groq' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder={
                      hasGroqKey
                        ? 'Clé Groq configurée ✓ (saisir pour remplacer)'
                        : 'Clé API Groq (gsk_…) — console.groq.com'
                    }
                    value={groqInput}
                    onChange={(e) => setGroqInput(e.target.value)}
                    style={{ maxWidth: 420 }}
                  />
                  <button onClick={saveGroqKey} disabled={!groqInput.trim()}>
                    Enregistrer
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Recadrage 9:16 :</span>
            <select
              value={reframeFocus}
              onChange={(e) => changeReframe(e.target.value)}
              style={{
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px'
              }}
            >
              <option value="center">Centré</option>
              <option value="left">Gauche</option>
              <option value="right">Droite</option>
              <option value="face">Visage auto (expérimental, télécharge un modèle)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Cookies navigateur (anti-bot YouTube) :
            </span>
            <select
              value={cookiesBrowser}
              onChange={(e) => changeCookies(e.target.value)}
              style={{
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px'
              }}
            >
              <option value="">Aucun</option>
              <option value="chrome">Chrome</option>
              <option value="firefox">Firefox</option>
              <option value="edge">Edge</option>
              <option value="brave">Brave</option>
            </select>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Si YouTube bloque (« Sign in to confirm you're not a bot »), choisis le navigateur où tu
            es connecté à YouTube. ⚠️ Avec Chrome, il faut le <strong>fermer</strong> pendant le
            téléchargement.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              …ou un fichier <strong>cookies.txt</strong> (prioritaire, Chrome peut rester ouvert) :
            </span>
            <button onClick={pickCookiesFile}>Choisir</button>
            {cookiesFile && (
              <>
                <span style={{ fontSize: 11, color: 'var(--accent-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cookiesFile.split(/[\\/]/).pop()}
                </span>
                <button onClick={clearCookiesFile}>Retirer</button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              YouTube bloque (« format not available » / vignettes seules) ?
            </span>
            <button onClick={doUpdateYtDlp}>Mettre à jour yt-dlp</button>
            <button onClick={doInstallPot}>Installer le plugin PO token (YouTube)</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Le plugin PO token nécessite le conteneur Docker bgutil (voir les instructions).
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Publication &amp; planification</div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Mode :</span>
            <select
              value={pubMode}
              onChange={(e) =>
                changePubMode(e.target.value as 'export' | 'tiktok' | 'tiktok_draft')
              }
              style={{
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px'
              }}
            >
              <option value="export">Export vers un dossier (sans API)</option>
              <option value="tiktok_draft">Brouillon TikTok (sans audit, tu valides en public)</option>
              <option value="tiktok">Publication directe TikTok (nécessite app auditée)</option>
            </select>
          </div>

          {pubMode === 'export' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Dossier : {exportDir || '(par défaut : userData/exports)'}
              </span>
              <button onClick={pickExportDir}>Choisir le dossier</button>
            </div>
          )}

          {(pubMode === 'tiktok' || pubMode === 'tiktok_draft') && (
            <div
              style={{
                marginBottom: 10,
                padding: 10,
                borderRadius: 8,
                background: 'var(--panel-2)',
                border: '1px solid var(--border)'
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {pubMode === 'tiktok_draft'
                  ? '📥 Le clip arrive dans tes brouillons TikTok — tu finalises en public d’un tap (la légende est copiée). Fonctionne sans audit.'
                  : '⚠️ Publication directe : nécessite une app TikTok auditée. Enregistre le redirect ci-dessous dans ta console.'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input
                  type="text"
                  placeholder="Client key"
                  value={ttKey}
                  onChange={(e) => setTtKey(e.target.value)}
                />
                <input
                  type="text"
                  placeholder={
                    ttStatus?.hasSecret
                      ? 'Client secret configuré ✓ (saisir pour remplacer)'
                      : 'Client secret (saisir pour définir)'
                  }
                  value={ttSecret}
                  onChange={(e) => setTtSecret(e.target.value)}
                />
              </div>
              <input
                type="text"
                placeholder="Redirect URI"
                value={ttRedirect}
                onChange={(e) => setTtRedirect(e.target.value)}
                style={{ marginBottom: 6 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="primary" onClick={saveTikTokConfig}>
                  Enregistrer la config
                </button>
                {ttStatus?.connected && <button onClick={tiktokDisconnect}>Déconnecter</button>}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {ttStatus?.connected
                    ? '● connecté'
                    : ttStatus?.hasConfig
                      ? '○ non connecté'
                      : '○ config incomplète'}
                </span>
              </div>

              {pubMode === 'tiktok' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Confidentialité :</span>
                  <select
                    value={ttPrivacy}
                    onChange={(e) => changePrivacy(e.target.value)}
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '7px 10px'
                    }}
                  >
                    <option value="SELF_ONLY">Privé / brouillon (requis si app non auditée)</option>
                    <option value="PUBLIC_TO_EVERYONE">Public (nécessite app auditée)</option>
                    <option value="MUTUAL_FOLLOW_FRIENDS">Amis</option>
                    <option value="FOLLOWER_OF_CREATOR">Abonnés</option>
                  </select>
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                Connexion manuelle (si le redirect loopback est refusé par TikTok) :
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={openAuthUrl} disabled={!ttStatus?.hasConfig}>
                  1) Ouvrir l’autorisation
                </button>
                <input
                  type="text"
                  placeholder="2) Colle le code (ou l’URL de redirection complète)"
                  value={ttCode}
                  onChange={(e) => setTtCode(e.target.value)}
                />
                <button onClick={submitCode} disabled={!ttCode.trim()}>
                  Valider le code
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <button onClick={checkCreator} disabled={!ttStatus?.connected}>
                  Vérifier le compte
                </button>
                {ttCreator && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{ttCreator}</span>
                )}
              </div>
            </div>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)', marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={schedEnabled}
              onChange={(e) => toggleSched(e.target.checked)}
            />
            Publication automatique planifiée des clips <strong>validés</strong>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Fréquence :</span>
            <select
              value={schedCron}
              onChange={(e) => changeCron(e.target.value)}
              disabled={!schedEnabled}
              style={{
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px'
              }}
            >
              {CRON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', minHeight: 0 }}>
        <section style={{ padding: 20, overflow: 'auto' }}>
          {view === 'sources' ? (
            <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="url"
              placeholder="URL YouTube / Twitch VOD à cliper…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSource()}
            />
            <button className="primary" onClick={addSource} disabled={busy}>
              Ajouter
            </button>
            <button onClick={importFile} disabled={busy} title="Traiter une vidéo déjà téléchargée (évite le blocage YouTube)">
              Importer un fichier
            </button>
          </div>

          {sources.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>Aucune source. Colle une URL pour commencer.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sources.map((s) => {
              const clips = clipsBySource[s.id] ?? []
              return (
                <div
                  key={s.id}
                  style={{
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.title || s.url}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                        #{s.id} · {s.author || 'auteur inconnu'} · statut: {s.status}
                        {s.error ? ` · ${s.error}` : ''}
                      </div>
                    </div>
                    <label
                      style={{
                        fontSize: 12,
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                      title="Nombre de clips à générer pour cette vidéo"
                    >
                      Clips :
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={clipCounts[s.id] ?? 3}
                        disabled={s.status === 'running'}
                        onChange={(e) =>
                          setClipCounts((m) => ({
                            ...m,
                            [s.id]: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1)))
                          }))
                        }
                        style={{ width: 52 }}
                      />
                    </label>
                    <button onClick={() => runPipeline(s.id)} disabled={s.status === 'running'}>
                      {s.status === 'running' ? 'En cours…' : 'Lancer le pipeline'}
                    </button>
                  </div>

                  {clips.length > 0 && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                      {clips.map((c) => (
                        <div key={c.id} style={{ width: 150 }}>
                          {c.filePath ? (
                            <video
                              src={clipUrl(c.filePath)}
                              controls
                              style={{ width: 150, borderRadius: 8, background: '#000', aspectRatio: '9 / 16' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 150,
                                aspectRatio: '9 / 16',
                                background: '#000',
                                borderRadius: 8
                              }}
                            />
                          )}
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            {c.title || `Clip ${Math.round(c.startSec)}s–${Math.round(c.endSec)}s`}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {c.score != null ? `score ${(c.score * 100).toFixed(0)}% · ` : ''}
                            <a
                              onClick={() => c.filePath && window.api.revealPath(c.filePath)}
                              style={{ cursor: 'pointer' }}
                            >
                              révéler
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {allClips.length === 0 && (
                <p style={{ color: 'var(--muted)' }}>
                  Aucun clip généré pour l'instant. Lance le pipeline sur une source.
                </p>
              )}
              {allClips.map((c) => {
                const src = sourceById[c.sourceId]
                return (
                  <div
                    key={c.id}
                    style={{
                      width: 200,
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 10
                    }}
                  >
                    {c.filePath ? (
                      <video
                        src={clipUrl(c.filePath)}
                        controls
                        style={{
                          width: '100%',
                          borderRadius: 8,
                          background: '#000',
                          aspectRatio: '9 / 16'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '9 / 16',
                          background: '#000',
                          borderRadius: 8
                        }}
                      />
                    )}
                    <div style={{ fontWeight: 600, marginTop: 6, fontSize: 14 }}>
                      {c.title || `Clip ${Math.round(c.startSec)}s–${Math.round(c.endSec)}s`}
                    </div>
                    {c.description && (
                      <div style={{ fontSize: 12, marginTop: 4 }}>{c.description}</div>
                    )}
                    {c.hashtags && (
                      <div style={{ fontSize: 12, marginTop: 4, color: 'var(--accent-2)' }}>
                        {c.hashtags}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      {c.score != null ? `score ${(c.score * 100).toFixed(0)}% · ` : ''}
                      {src?.author || src?.title || `source #${c.sourceId}`}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background:
                            c.reviewStatus === 'approved'
                              ? '#1d3a24'
                              : c.reviewStatus === 'rejected'
                                ? '#3a1d1d'
                                : 'var(--panel-2)',
                          color:
                            c.reviewStatus === 'approved'
                              ? '#46d369'
                              : c.reviewStatus === 'rejected'
                                ? '#ff6b6b'
                                : 'var(--muted)'
                        }}
                      >
                        {c.reviewStatus}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background: 'var(--panel-2)',
                          color: c.publishStatus === 'published' ? '#46d369' : 'var(--muted)'
                        }}
                      >
                        {c.publishStatus}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {c.reviewStatus !== 'approved' && (
                        <button onClick={() => review(c.id, 'approved')}>Approuver</button>
                      )}
                      {c.reviewStatus !== 'rejected' && (
                        <button onClick={() => review(c.id, 'rejected')}>Rejeter</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => copyCaption(c)}
                        disabled={!c.description && !c.hashtags}
                      >
                        Copier légende
                      </button>
                      <button onClick={() => c.filePath && window.api.revealPath(c.filePath)}>
                        Révéler
                      </button>
                      <button className="primary" onClick={() => startPublish(c)}>
                        {c.publishStatus === 'published' ? 'Republier' : 'Publier'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <aside
          style={{
            borderLeft: '1px solid var(--border)',
            padding: 16,
            background: 'var(--panel)',
            overflow: 'auto'
          }}
        >
          <h3 style={{ marginTop: 0, color: 'var(--muted)', fontWeight: 600 }}>Journal</h3>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              color: 'var(--muted)',
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
            }}
          >
            {log.join('\n') || 'En attente…'}
          </pre>
        </aside>
      </main>

      {pubModal && (
        <div
          onClick={() => !pubModal.publishing && setPubModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 20,
              width: 760,
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflow: 'auto',
              display: 'flex',
              gap: 18
            }}
          >
            <div style={{ width: 200, flexShrink: 0 }}>
              {pubModal.clip.filePath ? (
                <video
                  src={clipUrl(pubModal.clip.filePath)}
                  controls
                  style={{ width: 200, borderRadius: 8, background: '#000', aspectRatio: '9 / 16' }}
                />
              ) : (
                <div style={{ color: 'var(--muted)' }}>Pas d’aperçu</div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>Vérifier &amp; publier sur TikTok</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Compte : {pubModal.nickname ? `@${pubModal.nickname}` : ttProfile?.nickname ?? '—'}
                {pubMode === 'tiktok_draft' ? ' · mode Brouillon' : ' · mode Direct'}
              </div>

              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Légende</label>
              <textarea
                value={pubModal.caption}
                maxLength={2200}
                rows={4}
                onChange={(e) => setPubModal((m) => (m ? { ...m, caption: e.target.value } : m))}
                style={{ width: '100%', marginTop: 4 }}
              />

              {pubMode === 'tiktok' && (
                <>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginTop: 10 }}>
                    Confidentialité
                  </label>
                  <select
                    value={pubModal.privacy}
                    disabled={pubModal.loading}
                    onChange={(e) => setPubModal((m) => (m ? { ...m, privacy: e.target.value } : m))}
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    {(pubModal.privacyOptions.length ? pubModal.privacyOptions : ['SELF_ONLY']).map(
                      (o) => (
                        <option key={o} value={o}>
                          {privacyLabel(o)}
                        </option>
                      )
                    )}
                  </select>
                  {pubModal.loading && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Chargement des options du compte (creator_info)…
                    </div>
                  )}

                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={pubModal.allowComment}
                        disabled={pubModal.commentDisabled}
                        onChange={(e) =>
                          setPubModal((m) => (m ? { ...m, allowComment: e.target.checked } : m))
                        }
                      />{' '}
                      Autoriser les commentaires
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={pubModal.allowDuet}
                        disabled={pubModal.duetDisabled}
                        onChange={(e) =>
                          setPubModal((m) => (m ? { ...m, allowDuet: e.target.checked } : m))
                        }
                      />{' '}
                      Autoriser les Duos (Duet)
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={pubModal.allowStitch}
                        disabled={pubModal.stitchDisabled}
                        onChange={(e) =>
                          setPubModal((m) => (m ? { ...m, allowStitch: e.target.checked } : m))
                        }
                      />{' '}
                      Autoriser les Stitch
                    </label>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={pubModal.commercial}
                        onChange={(e) =>
                          setPubModal((m) => (m ? { ...m, commercial: e.target.checked } : m))
                        }
                      />{' '}
                      Divulguer un contenu commercial
                    </label>
                    {pubModal.commercial && (
                      <div
                        style={{ marginLeft: 18, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        <label style={{ fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={pubModal.brandOrganic}
                            onChange={(e) =>
                              setPubModal((m) => (m ? { ...m, brandOrganic: e.target.checked } : m))
                            }
                          />{' '}
                          Votre marque (vous faites votre propre promotion)
                        </label>
                        <label style={{ fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={pubModal.brandContent}
                            onChange={(e) =>
                              setPubModal((m) => (m ? { ...m, brandContent: e.target.checked } : m))
                            }
                          />{' '}
                          Contenu de marque (sponsorisé par un tiers)
                        </label>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          En publiant, tu confirmes respecter les Règles d’usage de la musique de TikTok.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {pubMode === 'tiktok_draft' && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                  Mode brouillon : la vidéo arrive dans ta boîte de réception TikTok ; tu choisis la
                  confidentialité en finalisant. La légende est copiée dans le presse-papier.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setPubModal(null)} disabled={pubModal.publishing}>
                  Annuler
                </button>
                <button className="primary" onClick={confirmPublish} disabled={pubModal.publishing}>
                  {pubModal.publishing ? 'Publication…' : 'Publier sur TikTok'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
