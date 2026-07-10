import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  api,
  subscribe,
  clipUrl,
  type SourceDTO,
  type ClipDTO,
  type ProgressEvent,
  type PublishOverrides,
  type ViralIdea,
  type SavedIdea
} from './api'

type Page = 'dashboard' | 'autopilot' | 'generate' | 'ideas' | 'history' | 'clips' | 'queue' | 'published' | 'settings'

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sources: 'M12 3l9 4-9 4-9-4 9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  clips: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M16 9h4M4 15h4M16 15h4',
  settings: 'M10.3 3.2a1 1 0 011.4 0l1 1a1 1 0 00.9.3l1.4-.2a1 1 0 011 .6l.6 1.3a1 1 0 00.7.6l1.3.3a1 1 0 01.8 1.1l-.2 1.4a1 1 0 00.3.9l1 1a1 1 0 010 1.4l-1 1a1 1 0 00-.3.9l.2 1.4M12 9a3 3 0 100 6 3 3 0 000-6z',
  logout: 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  play: 'M5 3l14 9-14 9z',
  pause: 'M8 5v14M16 5v14',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0012 3z',
  bookmark: 'M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z',
  chart: 'M4 20V10M10 20V4M16 20v-6M22 20H2',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  spark: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3z',
  check: 'M20 6L9 17l-5-5',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18'
}

// Valeur spéciale du sélecteur en haut à droite : « Tous les comptes » (vue globale).
const ALL_SCOPE = '__all__'
function Icon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

function Logo({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="210 40 260 260" xmlns="http://www.w3.org/2000/svg" aria-label="Cliperr" style={{ display: 'block', flexShrink: 0 }}>
      <rect x="210" y="40" width="260" height="260" rx="40" fill="#0a0a0d" />
      <g transform="translate(340,170) rotate(-22)" fill="none" stroke="#fff" strokeWidth="16" strokeLinecap="round">
        <path d="M 10.4,-59.1 A 60,60 0 1 0 10.4,59.1" />
        <path d="M 35.3,-48.5 A 60,60 0 0 1 60,0" />
        <path d="M 53.9,26.3 A 60,60 0 0 1 35.3,48.5" />
      </g>
    </svg>
  )
}

// ── Widget global de suivi des générations (bas droite, dépliable) ──
const GEN_STAGE_BASE: Record<string, number> = { ingest: 0, transcribe: 22, highlights: 35, extract: 48, reframe: 62, captions: 80, metadata: 92 }
const GEN_STAGE_RANGE: Record<string, number> = { ingest: 22, transcribe: 13, highlights: 13, extract: 14, reframe: 18, captions: 12, metadata: 8 }
function creatorPct(status: string, e?: ProgressEvent): number {
  if (status === 'queued') return 2
  if (!e) return 5
  if (e.status === 'error') return 100
  const base = GEN_STAGE_BASE[e.stage] ?? 0
  const range = GEN_STAGE_RANGE[e.stage] ?? 10
  return Math.min(99, base + (e.progress || 0) * range)
}
function aiPct(msg: string): number {
  const m = msg.match(/Sc[eè]ne (\d+)\/(\d+)/i)
  if (m) {
    const x = Number(m[1])
    const n = Number(m[2]) || 1
    const sub = /image/i.test(msg) ? 0.45 : /montage/i.test(msg) ? 0.85 : 0
    return 10 + ((x - 1 + sub) / n) * 74
  }
  if (/assemblage/i.test(msg)) return 88
  if (/musique de fond/i.test(msg)) return 93
  return 6
}

function GenerationsWidget({ sources, progress, ideaVideo }: { sources: SourceDTO[]; progress: Record<number, ProgressEvent>; ideaVideo: Record<number, { status: 'running' | 'done' | 'error'; message: string }> }): JSX.Element | null {
  const [open, setOpen] = useState(true)
  const items: { key: string; label: string; pct: number; msg: string; error: boolean }[] = []
  for (const s of sources) {
    if (s.status === 'running' || s.status === 'queued') {
      const e = progress[s.id]
      items.push({
        key: 's' + s.id,
        label: s.title || s.url?.split(/[\\/]/).pop() || `Clip #${s.id}`,
        pct: creatorPct(s.status, e),
        msg: e?.message || (s.status === 'queued' ? 'En file d’attente…' : 'En cours…'),
        error: e?.status === 'error'
      })
    }
  }
  for (const [id, v] of Object.entries(ideaVideo)) {
    if (v.status === 'running') items.push({ key: 'i' + id, label: 'Vidéo IA', pct: aiPct(v.message), msg: v.message, error: false })
  }
  if (!items.length) return null

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60, width: open ? 330 : 'auto', maxWidth: 'calc(100vw - 32px)' }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.18)' }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--accent)', color: '#fff', border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
          <span className="dot" style={{ background: '#fff' }} />
          {items.length} génération{items.length > 1 ? 's' : ''} en cours
          <span style={{ marginLeft: 'auto', fontSize: 12 }}>{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 340, overflowY: 'auto' }}>
            {items.map((it) => (
              <div key={it.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                  <span className="muted small">{Math.round(it.pct)}%</span>
                </div>
                <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '2px 0 5px' }}>{it.msg}</div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(3, Math.min(100, it.pct))}%`, background: it.error ? '#b91c1c' : 'var(--accent)', transition: 'width .4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type PubProfile = { username: string; handle: string | null; avatarUrl: string | null }

function Avatar({ url, name, size = 22 }: { url: string | null; name?: string; size?: number }): JSX.Element {
  const [err, setErr] = useState(false)
  return url && !err ? (
    <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setErr(true)} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#000' }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5, fontWeight: 700, flexShrink: 0 }}>
      {(name?.[0] ?? 'C').toUpperCase()}
    </span>
  )
}

function GlobeBadge({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name="globe" size={Math.round(size * 0.62)} />
    </span>
  )
}

function ProfilePicker({ profiles, active, onChange }: { profiles: PubProfile[]; active: string; onChange: (u: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const isAll = active === ALL_SCOPE
  const cur = profiles.find((p) => p.username === active)
  const label = (p: PubProfile): string => (p.handle ? `@${p.handle}` : p.username)
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isAll ? <GlobeBadge /> : <Avatar url={cur?.avatarUrl ?? null} name={cur?.username} />}
        {isAll ? 'Tous les comptes' : cur ? label(cur) : '—'}
        <span style={{ opacity: 0.5, fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 31, minWidth: 240, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              className="nav-item"
              onClick={() => { onChange(ALL_SCOPE); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: isAll ? 'var(--accent-soft-2)' : undefined }}
            >
              <GlobeBadge />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span style={{ fontWeight: 600 }}>Tous les comptes</span>
                <span className="muted small">Vue d’ensemble</span>
              </span>
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
            {profiles.map((p) => (
              <button
                key={p.username}
                className="nav-item"
                onClick={() => { onChange(p.username); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: p.username === active ? 'var(--accent-soft-2)' : undefined }}
              >
                <Avatar url={p.avatarUrl} name={p.username} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(p)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

type PublishStateT = { mode: string; profiles: PubProfile[]; active: string; scope: string; quotaReached: boolean; quotaProfile: string | null }

// Barre globale (haut de chaque page) : bannière « quota atteint » + sélecteur
// de portée (un profil précis, ou « Tous les comptes » pour la vue d'ensemble).
function TopBar({ state, onChange }: { state: PublishStateT | null; onChange: (v: string) => void }): JSX.Element | null {
  if (!state || state.mode !== 'uploadpost' || state.profiles.length === 0) return null
  const quotaProf = state.profiles.find((p) => p.username === state.quotaProfile)
  return (
    <div style={{ marginBottom: 16 }}>
      {state.quotaReached && (
        <div className="card" style={{ marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div className="small">
            <b>Quota journalier atteint pour {quotaProf?.handle ? `@${quotaProf.handle}` : state.quotaProfile}.</b> TikTok limite le nombre de publications par jour et par compte. La publication reprendra automatiquement dès que possible — ou choisis un autre profil à droite.
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        <span className="muted small" style={{ whiteSpace: 'nowrap' }}>Profil actif</span>
        <ProfilePicker profiles={state.profiles} active={state.scope} onChange={onChange} />
      </div>
    </div>
  )
}

export function App(): JSX.Element | null {
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    api.me().then((r) => setAuthed(r.authed)).catch(() => setAuthed(false))
  }, [])
  if (authed === null) return null
  if (!authed) return <Login onOk={() => setAuthed(true)} />
  return <Shell onLogout={() => setAuthed(false)} />
}

function Login({ onOk }: { onOk: () => void }): JSX.Element {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(): Promise<void> {
    setBusy(true)
    setErr('')
    try {
      await api.login(pw)
      onOk()
    } catch {
      setErr('Mot de passe incorrect')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ justifyContent: 'center' }}>
<Logo size={34} /> Cliperr
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>Connecte-toi pour accéder au dashboard.</p>
        <input
          className="input-full"
          type="password"
          placeholder="Mot de passe"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ marginTop: 12 }}
        />
        {err && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} onClick={submit} disabled={busy || !pw}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </div>
    </div>
  )
}

function Shell({ onLogout }: { onLogout: () => void }): JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')
  const [sources, setSources] = useState<SourceDTO[]>([])
  const [clips, setClips] = useState<ClipDTO[]>([])
  const [log, setLog] = useState<string[]>([])
  const [ttProfile, setTtProfile] = useState<{ nickname: string | null; avatarUrl: string | null } | null>(null)
  const [toast, setToast] = useState('')
  const [progress, setProgress] = useState<Record<number, ProgressEvent>>({})
  const [ideaVideo, setIdeaVideo] = useState<Record<number, { status: 'running' | 'done' | 'error'; message: string }>>({})
  const [pub, setPub] = useState<PublishStateT | null>(null)

  const loadPub = useCallback((): void => { api.publishState().then(setPub).catch(() => undefined) }, [])
  useEffect(() => {
    loadPub()
    const t = window.setInterval(loadPub, 20000)
    return () => window.clearInterval(t)
  }, [loadPub])

  const pushLog = useCallback((m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 200)), [])
  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([api.listSources(), api.listClips()])
    setSources(s)
    setClips(c)
  }, [])

  useEffect(() => {
    refresh().catch(() => undefined)
    api.tiktokProfile().then((p) => setTtProfile(p)).catch(() => undefined)
    const unsub = subscribe({
      // (Re)connexion du flux : purge les générations « en cours » orphelines
      // (un redémarrage serveur tue la génération sans émettre d'événement de fin).
      onOpen: () =>
        setIdeaVideo((m) => {
          const next: typeof m = {}
          for (const [k, v] of Object.entries(m)) if (v.status !== 'running') next[Number(k)] = v
          return next
        }),
      onLog: (m) => pushLog(m),
      onProgress: (e: ProgressEvent) => {
        pushLog(`[${e.stage}] ${e.status} ${Math.round((e.progress || 0) * 100)}%${e.message ? ' — ' + e.message : ''}`)
        setProgress((pm) => ({ ...pm, [e.sourceId]: e }))
        if (e.status === 'done' || e.status === 'error') refresh().catch(() => undefined)
      },
      onIdeaVideo: (e) => {
        setIdeaVideo((m) => ({ ...m, [e.ideaId]: { status: e.status, message: e.message } }))
        if (e.status === 'done' || e.status === 'error') refresh().catch(() => undefined)
      }
    })
    return unsub
  }, [refresh, pushLog])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('tiktok')
    if (!p) return
    if (p === 'connected') {
      setToast('TikTok connecté ✅')
      api.tiktokProfile().then(setTtProfile).catch(() => undefined)
    } else {
      setToast('Connexion TikTok échouée')
    }
    window.history.replaceState({}, '', '/')
    const t = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(t)
  }, [])

  const showToast = (m: string): void => {
    setToast(m)
    window.setTimeout(() => setToast(''), 3500)
  }

  const changeScope = async (v: string): Promise<void> => {
    setPub((s) => (s ? { ...s, scope: v, active: v === ALL_SCOPE ? (s.profiles[0]?.username ?? s.active) : v } : s))
    await api.setFlag('active_profile', v)
    showToast(v === ALL_SCOPE ? 'Vue : tous les comptes' : 'Profil actif changé')
    loadPub()
  }
  const scope = pub?.scope ?? ALL_SCOPE
  const isAll = scope === ALL_SCOPE

  // Le pilote auto pilote TOUS les comptes → visible uniquement en vue « Tous les comptes ».
  useEffect(() => {
    if (page === 'autopilot' && !isAll) setPage('dashboard')
  }, [page, isAll])

  const navGroups: { id: Page; label: string; icon: string }[][] = [
    [
      { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
      ...(isAll ? [{ id: 'autopilot' as Page, label: 'Pilote auto', icon: 'bolt' }] : []),
      { id: 'queue', label: 'File d’attente', icon: 'clock' }
    ],
    [
      { id: 'ideas', label: 'Idées virales', icon: 'bulb' },
      { id: 'generate', label: 'Générer', icon: 'spark' },
      { id: 'clips', label: 'Clips', icon: 'clips' },
      { id: 'published', label: 'Publiés', icon: 'send' }
    ],
    [
      { id: 'history', label: 'Historique', icon: 'list' },
      { id: 'settings', label: 'Réglages', icon: 'settings' }
    ]
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 8px' }}>
          <div className="brand" style={{ padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Logo size={30} /> Cliperr</div>
        </div>
        <div className="side-search">
          <Icon name="search" size={15} /> Rechercher <span className="kbd">Ctrl K</span>
        </div>
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '8px 10px' }} />}
            {group.map((n) => (
              <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
                <Icon name={n.icon} /> {n.label}
              </button>
            ))}
          </div>
        ))}
        <div className="spacer" />
        <div className="user-card">
          <div className="avatar">
            {ttProfile?.avatarUrl ? <img src={ttProfile.avatarUrl} alt="" width={34} height={34} referrerPolicy="no-referrer" /> : (ttProfile?.nickname?.[0] ?? 'C')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ttProfile?.nickname ? `@${ttProfile.nickname}` : 'Compte'}
            </div>
            <div className="muted small">TikTok</div>
          </div>
          <button className="nav-item" style={{ width: 'auto', padding: 8 }} title="Déconnexion" onClick={() => api.logout().then(onLogout)}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <main className="main">
        <TopBar state={pub} onChange={changeScope} />
        {page === 'dashboard' && <Dashboard log={log} go={setPage} onRefresh={refresh} scope={scope} />}
        {page === 'autopilot' && isAll && <Autopilot toast={showToast} />}
        {page === 'generate' && <Generate sources={sources} progress={progress} onRefresh={refresh} toast={showToast} goHistory={() => setPage('history')} />}
        {page === 'ideas' && <Ideas toast={showToast} go={setPage} />}
        {page === 'history' && <History sources={sources} clips={clips} progress={progress} onRefresh={refresh} toast={showToast} goClips={() => setPage('clips')} />}
        {page === 'clips' && <Clips clips={clips} sources={sources} onRefresh={refresh} toast={showToast} ttProfile={ttProfile} scope={scope} />}
        {page === 'queue' && <Queue clips={clips} go={setPage} scope={scope} ideaVideo={ideaVideo} />}
        {page === 'published' && <Published clips={clips} go={setPage} scope={scope} />}
        {page === 'settings' && <Settings toast={showToast} onTtProfile={setTtProfile} />}
      </main>
      <GenerationsWidget sources={sources} progress={progress} ideaVideo={ideaVideo} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function TrendBadge({ value, label }: { value: number; label?: string }): JSX.Element {
  const up = value >= 0
  return (
    <span className={`trend ${up ? 'up' : 'down'}`}>
      {up ? '↑' : '↓'} {label ?? `${up ? '+' : ''}${value}%`}
    </span>
  )
}

type Bucket = { label: string; count: number }

function AreaChart({ data }: { data: Bucket[] }): JSX.Element {
  const W = 600
  const H = 200
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length
  const x = (i: number): number => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number): number => H - 6 - (v / max) * (H - 16)
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220, display: 'block' }}>
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ag)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="small muted">{data[0]?.label}</span>
        <span className="small muted">{data[Math.floor(n / 2)]?.label}</span>
        <span className="small muted">{data[n - 1]?.label}</span>
      </div>
    </div>
  )
}

function Dashboard({ log, go, onRefresh, scope }: { log: string[]; go: (p: Page) => void; onRefresh: () => Promise<void>; scope: string }): JSX.Element {
  const [data, setData] = useState<AnalyticsProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<AnalyticsProfile | null>(null)
  const [posts, setPosts] = useState<PostStat[] | null>(null)
  const [pLoading, setPLoading] = useState(false)

  const loadPerf = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { setData((await api.analytics()).profiles) } catch { setData([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void loadPerf() }, [loadPerf])

  const openProfile = async (p: AnalyticsProfile): Promise<void> => {
    setOpen(p); setPosts(null); setPLoading(true)
    try { setPosts((await api.analyticsPosts(p.profile)).posts) } catch { setPosts([]) } finally { setPLoading(false) }
  }
  const eng = (p: { views: number; likes: number; comments: number; shares: number }): string =>
    p.views > 0 ? (((p.likes + p.comments + p.shares) / p.views) * 100).toFixed(1) + '%' : '—'

  // ── Détail par vidéo d'un compte (drill-down) ──
  if (open) {
    const list = (posts ?? []).slice().sort((a, b) => b.views - a.views)
    return (
      <>
        <div className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn icon-btn" onClick={() => setOpen(null)} title="Retour">←</button>
            <Avatar url={open.avatarUrl} name={open.profile} size={36} />
            <div>
              <h1 style={{ fontSize: 22 }}>{open.handle ? '@' + open.handle : open.profile}</h1>
              <p>Détail par vidéo (publiées via Cliperr)</p>
            </div>
          </div>
          <button className="btn" onClick={() => openProfile(open)} disabled={pLoading}><Icon name="refresh" size={15} /> Actualiser</button>
        </div>
        {pLoading && !posts ? (
          <div className="card muted">Chargement des vidéos…</div>
        ) : list.length === 0 ? (
          <div className="card muted">Aucune vidéo trackée pour ce compte. Les vidéos publiées via Cliperr <b>à partir de maintenant</b> apparaîtront ici avec leurs stats détaillées.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((v) => (
              <div key={v.clipId} className="card">
                <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                  {v.filePath && <video src={clipUrl(v.filePath)} muted preload="metadata" style={{ width: 46, borderRadius: 8, background: '#000', aspectRatio: '9 / 16', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title || `Vidéo #${v.clipId}`}</div>
                    {v.postUrl && <a href={v.postUrl} target="_blank" rel="noreferrer" className="small" style={{ color: 'var(--accent)' }}>Voir sur TikTok ↗</a>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                    {[['Vues', v.views], ['Likes', v.likes], ['Comm.', v.comments], ['Part.', v.shares]].map(([l, n]) => (
                      <div key={l as string} style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700 }}>{fmtNum(n as number)}</div>
                        <div className="muted small">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  const profiles = (data ?? []).filter((p) => scope === ALL_SCOPE || p.profile === scope).slice().sort((a, b) => b.views - a.views)
  const totals = profiles.reduce(
    (t, p) => ({ views: t.views + p.views, likes: t.likes + p.likes, comments: t.comments + p.comments, shares: t.shares + p.shares, followers: t.followers + p.followers, videos: t.videos + p.videoCount }),
    { views: 0, likes: 0, comments: 0, shares: 0, followers: 0, videos: 0 }
  )

  // Série temporelle agrégée (somme des portées par jour) → format AreaChart.
  const byDate = new Map<string, number>()
  for (const p of profiles) for (const t of p.timeseries) byDate.set(t.date, (byDate.get(t.date) || 0) + (t.value || 0))
  const series = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const buckets: Bucket[] = series.map(([date, v]) => {
    const d = date.split('-')
    return { label: d.length === 3 ? `${d[2]}/${d[1]}` : date, count: v }
  })
  const totalPeriod = buckets.reduce((a, b) => a + b.count, 0)
  const avgPerDay = buckets.length ? Math.round(totalPeriod / buckets.length) : 0
  const peak = buckets.reduce((m, b) => (b.count > m.count ? b : m), { label: '—', count: 0 })
  const vals = buckets.map((b) => b.count)
  const last7 = vals.slice(-7).reduce((a, b) => a + b, 0)
  const prev7 = vals.slice(-14, -7).reduce((a, b) => a + b, 0)
  const viewsTrend = prev7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prev7) / prev7) * 100)
  const avgViewsPerVideo = totals.videos ? Math.round(totals.views / totals.videos) : 0
  const engGlobal = eng(totals)
  const maxViews = Math.max(1, ...profiles.map((p) => p.views))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>Performances de tes comptes TikTok (30 derniers jours).</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => go('generate')}><Icon name="spark" size={16} /> Générer</button>
          <button className="btn icon-btn" onClick={() => { void onRefresh(); void loadPerf() }} title="Rafraîchir">
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="card muted">Chargement des performances…</div>
      ) : profiles.length === 0 ? (
        <div className="card muted">Aucune donnée de performance. Configure la clé upload-post (Réglages) et publie des vidéos.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 }}>
            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="chart" /></div>
                <TrendBadge value={viewsTrend} />
              </div>
              <div className="label" style={{ marginTop: 14 }}>Vues (30 j)</div>
              <div className="value">{fmtNum(totals.views)}</div>
              <div className="breakdown">
                <div className="line"><span className="k">≈ / vidéo</span><span className="v">{fmtNum(avgViewsPerVideo)}</span></div>
                <div className="line"><span className="k">7 derniers jours</span><span className="v">{fmtNum(last7)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="spark" /></div>
                <span className="pill-badge"><span className="dot" /> {engGlobal}</span>
              </div>
              <div className="label" style={{ marginTop: 14 }}>Likes</div>
              <div className="value">{fmtNum(totals.likes)}</div>
              <div className="breakdown">
                <div className="line"><span className="k">Commentaires</span><span className="v">{fmtNum(totals.comments)}</span></div>
                <div className="line"><span className="k">Partages</span><span className="v">{fmtNum(totals.shares)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="globe" /></div>
              </div>
              <div className="label" style={{ marginTop: 14 }}>Abonnés</div>
              <div className="value">{fmtNum(totals.followers)}</div>
              <div className="breakdown">
                <div className="line"><span className="k">Comptes</span><span className="v">{profiles.length}</span></div>
                <div className="line"><span className="k">Top compte</span><span className="v">{profiles[0]?.handle ? '@' + profiles[0].handle : profiles[0]?.profile ?? '—'}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="clips" /></div>
              </div>
              <div className="label" style={{ marginTop: 14 }}>Vidéos publiées</div>
              <div className="value">{totals.videos}</div>
              <div className="breakdown">
                <div className="line"><span className="k">Engagement</span><span className="v">{engGlobal}</span></div>
                <div className="line"><span className="k">Vues / vidéo</span><span className="v">{fmtNum(avgViewsPerVideo)}</span></div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="card">
              <div className="row">
                <div>
                  <strong>Vues dans le temps</strong>
                </div>
              </div>
              <div style={{ marginTop: 14 }}><AreaChart data={buckets} /></div>
              <div className="metrics-row">
                <div className="metric"><div className="ml">Total période</div><div className="mv">{fmtNum(totalPeriod)}</div></div>
                <div className="metric"><div className="ml">Moyenne / jour</div><div className="mv">{fmtNum(avgPerDay)}</div></div>
                <div className="metric"><div className="ml">Pic</div><div className="mv">{fmtNum(peak.count)} · {peak.label}</div></div>
              </div>
            </div>

            <div className="card">
              <strong>Répartition des vues</strong>
              <p className="muted small" style={{ marginTop: 2 }}>Par compte · clique pour le détail</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                {profiles.map((p) => (
                  <div key={p.profile} className="funnel-row" style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }} onClick={() => openProfile(p)}>
                    <Avatar url={p.avatarUrl} name={p.profile} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <span className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.handle ? '@' + p.handle : p.profile}</span>
                        <span className="small muted">{fmtNum(p.views)}</span>
                      </div>
                      <div className="bar"><div style={{ width: `${(p.views / maxViews) * 100}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="gauge-wrap">
                <div>
                  <div className="ml">Engagement global</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-strong)' }}>{engGlobal}</div>
                  <div className="small muted">likes + comm. + partages / vues</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {profiles.map((p, i) => (
              <div key={p.profile} className="card folder" style={{ display: 'block' }} onClick={() => openProfile(p)}>
                <div className="row" style={{ alignItems: 'center', gap: 12 }}>
                  <Avatar url={p.avatarUrl} name={p.profile} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>
                      {p.handle ? '@' + p.handle : p.profile}
                      {i === 0 && p.views > 0 && <span className="chip" style={{ marginLeft: 8 }}>🏆 top</span>}
                      {p.videoCount > 0 && p.views === 0 && <span className="chip" style={{ marginLeft: 8, background: '#fef3c7', color: '#b45309' }}>⏳ stats en attente</span>}
                    </div>
                    <div className="muted small">{p.videoCount} vidéo{p.videoCount > 1 ? 's' : ''} · {fmtNum(p.followers)} abonné{p.followers > 1 ? 's' : ''}</div>
                  </div>
                  <Sparkline data={p.timeseries.map((t) => t.value)} />
                </div>
                <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {[['Vues', fmtNum(p.views), true], ['Likes', fmtNum(p.likes), false], ['Comment.', fmtNum(p.comments), false], ['Partages', fmtNum(p.shares), false]].map(([l, v, big]) => (
                    <div key={l as string}>
                      <div style={{ fontWeight: 700, fontSize: big ? 22 : 16, color: big ? 'var(--accent-strong)' : undefined }}>{v}</div>
                      <div className="muted small">{l}</div>
                    </div>
                  ))}
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div className="muted small">≈ {p.videoCount ? fmtNum(Math.round(p.views / p.videoCount)) : 0} vues/vidéo · {eng(p)} engagement</div>
                    <div className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>Voir les vidéos →</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Activité en direct</strong>
              <span className="chip">SSE</span>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--muted)', maxHeight: 200, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {log.join('\n') || 'En attente…'}
            </pre>
          </div>
        </>
      )}
    </>
  )
}

const STAGE_LABELS: Record<string, string> = {
  ingest: 'Téléchargement / import',
  transcribe: 'Transcription',
  highlights: 'Sélection des moments (IA)',
  reframe: 'Génération des clips',
  metadata: 'Génération des légendes'
}

function Generate({ sources, progress, onRefresh, toast, goHistory }: { sources: SourceDTO[]; progress: Record<number, ProgressEvent>; onRefresh: () => Promise<void>; toast: (m: string) => void; goHistory: () => void }): JSX.Element {
  const [step, setStep] = useState<'import' | 'count'>('import')
  const [tab, setTab] = useState<'upload' | 'url'>('upload')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [newSource, setNewSource] = useState<SourceDTO | null>(null)
  const [clipCount, setClipCount] = useState(3)
  const fileRef = useRef<HTMLInputElement>(null)

  function imported(src: SourceDTO): void {
    setNewSource(src)
    setStep('count')
  }
  async function addUrl(): Promise<void> {
    if (!url.trim()) return
    setBusy(true)
    try {
      const src = await api.addSource(url.trim())
      setUrl('')
      await onRefresh()
      imported(src)
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    } finally {
      setBusy(false)
    }
  }
  async function uploadFile(file: File): Promise<void> {
    if (!file) return
    if (file.size < 100 * 1024) {
      toast(`Fichier trop petit (${file.size} octets) — ce n’est pas une vidéo valide (téléchargement incomplet ?).`)
      return
    }
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)) {
      toast('Ce fichier n’est pas une vidéo.')
      return
    }
    setUploadPct(0)
    try {
      const src = await api.uploadSource(file, (r) => setUploadPct(Math.round(r * 100)))
      await onRefresh()
      imported(src)
    } catch (err) {
      toast(`Upload échoué : ${String((err as Error).message)}`)
    } finally {
      setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  function onFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (f) void uploadFile(f)
  }
  async function launch(): Promise<void> {
    if (!newSource) return
    setBusy(true)
    try {
      await api.runPipeline(newSource.id, clipCount)
      toast(`Génération lancée (${clipCount} clip${clipCount > 1 ? 's' : ''})`)
      setNewSource(null)
      setClipCount(3)
      setStep('import')
      setTab('upload')
      await onRefresh()
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    } finally {
      setBusy(false)
    }
  }

  const active = sources.filter((s) => s.status === 'queued' || s.status === 'running')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Générer</h1>
          <p>Importe une vidéo, choisis le nombre de clips, lance la génération.</p>
        </div>
        <button className="btn" onClick={goHistory}><Icon name="list" size={16} /> Historique</button>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="stepper">
          <div className={`step ${step === 'import' ? 'on' : 'done'}`}><span className="n">1</span> Importer</div>
          <div className="step-line" />
          <div className={`step ${step === 'count' ? 'on' : ''}`}><span className="n">2</span> Nombre de clips</div>
        </div>

        {step === 'import' && (
          <div style={{ marginTop: 18 }}>
            <div className="tabs">
              <button className={`tab ${tab === 'upload' ? 'on' : ''}`} onClick={() => setTab('upload')}><Icon name="upload" size={16} /> Importer un fichier</button>
              <button className={`tab ${tab === 'url' ? 'on' : ''}`} onClick={() => setTab('url')}><Icon name="sources" size={16} /> Télécharger (URL)</button>
            </div>
            {tab === 'upload' ? (
              <div>
                <div
                  className={`dropzone ${dragging ? 'drag' : ''}`}
                  onClick={() => uploadPct === null && fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
                  onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void uploadFile(f) }}
                >
                  <div className="dz-icon"><Icon name="upload" size={24} /></div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{uploadPct !== null ? `Upload en cours… ${uploadPct}%` : 'Glisse ton fichier vidéo ici'}</div>
                  <div className="small" style={{ marginTop: 4 }}>ou clique pour parcourir · mp4, mov, mkv, webm</div>
                </div>
                {uploadPct !== null && <div className="bar" style={{ marginTop: 12 }}><div style={{ width: `${uploadPct}%` }} /></div>}
                <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <input className="input-full" style={{ flex: 1, minWidth: 260 }} placeholder="URL YouTube / Twitch…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
                  <button className="btn primary" onClick={addUrl} disabled={busy}>Continuer</button>
                </div>
                <p className="muted small" style={{ marginTop: 10 }}>⚠️ Sur ce serveur, YouTube par URL est souvent bloqué — préfère l’import de fichier.</p>
              </div>
            )}
          </div>
        )}

        {step === 'count' && newSource && (
          <div style={{ marginTop: 18 }}>
            <div className="muted small">Vidéo</div>
            <div style={{ fontWeight: 600, marginBottom: 18 }}>{newSource.title || newSource.url?.split(/[\\/]/).pop()}</div>
            <label className="muted small">Nombre de clips à générer</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
              <input type="range" min={1} max={10} value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} style={{ flex: 1 }} />
              <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--accent-strong)', minWidth: 40, textAlign: 'center' }}>{clipCount}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setStep('import'); setNewSource(null) }}>Retour</button>
              <button className="btn primary" onClick={launch} disabled={busy}>{busy ? 'Lancement…' : '🚀 Lancer la génération'}</button>
            </div>
          </div>
        )}
      </div>

      {active.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 10px' }}>Générations en cours ({active.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {active.map((s) => {
              const p = progress[s.id]
              const pct = s.status === 'queued' ? 0 : Math.round((p?.progress ?? 0) * 100)
              const stage = s.status === 'queued' ? 'En file d’attente' : STAGE_LABELS[p?.stage ?? 'ingest'] ?? p?.stage ?? '…'
              return (
                <div key={s.id} className="card">
                  <div className="row" style={{ marginBottom: 8 }}>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.url?.split(/[\\/]/).pop()}</strong>
                    <span className="pill-badge"><span className="dot" /> {s.status === 'queued' ? 'En attente' : 'En cours'}</span>
                  </div>
                  <div className="muted small" style={{ marginBottom: 6 }}>{stage}{p?.message ? ` — ${p.message}` : ''}</div>
                  <div className="bar"><div style={{ width: `${pct}%`, transition: 'width .4s' }} /></div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function History({ sources, clips, onRefresh, toast, goClips }: { sources: SourceDTO[]; clips: ClipDTO[]; progress: Record<number, ProgressEvent>; onRefresh: () => Promise<void>; toast: (m: string) => void; goClips: () => void }): JSX.Element {
  const [counts, setCounts] = useState<Record<number, number>>({})
  async function run(id: number): Promise<void> {
    try {
      await api.runPipeline(id, counts[id] ?? 3)
      await onRefresh()
      toast('Génération relancée')
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    }
  }
  const statusLabel = (s: string): string =>
    ({ done: 'Terminé', running: 'En cours', queued: 'En attente', error: 'Erreur', pending: 'Non lancé' } as Record<string, string>)[s] || s
  const busy = (s: string): boolean => s === 'running' || s === 'queued'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Historique</h1>
          <p>Toutes tes générations (vidéos sources, statut, nombre de clips).</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.length === 0 && <div className="card muted">Aucune génération pour l’instant.</div>}
        {[...sources].reverse().map((s) => (
          <div key={s.id} className="card">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || s.url}</div>
                <div className="muted small">
                  #{s.id} · {clips.filter((c) => c.sourceId === s.id).length} clip(s) · {statusLabel(s.status)}
                  {s.error ? ` · ${s.error}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Clips
                  <input type="number" min={1} max={10} value={counts[s.id] ?? 3} disabled={busy(s.status)} onChange={(e) => setCounts((m) => ({ ...m, [s.id]: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))) }))} style={{ width: 56 }} />
                </label>
                <button className="btn" onClick={() => run(s.id)} disabled={busy(s.status)}>{busy(s.status) ? '…' : 'Relancer'}</button>
                <button className="btn" onClick={goClips}>Voir clips</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label}
    </label>
  )
}

function ClipCard({ c, onReview, onPublish }: { c: ClipDTO; onReview: (id: number, s: ClipDTO['reviewStatus']) => void; onPublish: (c: ClipDTO) => void }): JSX.Element {
  return (
    <div className="card" style={{ padding: 12 }}>
      {c.filePath ? (
        <video src={clipUrl(c.filePath)} controls style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '9 / 16' }} />
      ) : (
        <div className="muted small">Pas d’aperçu</div>
      )}
      <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14 }}>{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
      {c.hashtags && <div className="small" style={{ color: 'var(--accent)', marginTop: 2 }}>{c.hashtags}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small muted">{c.score != null ? `score ${(c.score * 100).toFixed(0)}%` : ''}</span>
        <span className="chip" style={{ background: c.publishStatus === 'published' ? '#dcfce7' : 'var(--accent-soft)', color: c.publishStatus === 'published' ? 'var(--good)' : 'var(--accent-strong)' }}>{c.publishStatus}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {c.reviewStatus !== 'approved' && <button className="btn small" onClick={() => onReview(c.id, 'approved')}>Approuver</button>}
        {c.reviewStatus !== 'rejected' && <button className="btn small" onClick={() => onReview(c.id, 'rejected')}>Rejeter</button>}
        <button className="btn primary small" onClick={() => onPublish(c)}>{c.publishStatus === 'published' ? 'Republier' : 'Publier'}</button>
      </div>
    </div>
  )
}

function Clips({ clips, sources, onRefresh, toast, ttProfile, scope }: { clips: ClipDTO[]; sources: SourceDTO[]; onRefresh: () => Promise<void>; toast: (m: string) => void; ttProfile: { nickname: string | null } | null; scope: string }): JSX.Element {
  const [modal, setModal] = useState<ClipDTO | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [tab, setTab] = useState<'creator' | 'ai'>('creator')
  const [autoApprove, setAutoApprove] = useState(false)
  useEffect(() => {
    api.getFlag('auto_approve').then((r) => setAutoApprove(r.value === '1')).catch(() => undefined)
  }, [])
  async function toggleAuto(v: boolean): Promise<void> {
    setAutoApprove(v)
    await api.setFlag('auto_approve', v ? '1' : '0')
    toast(v ? 'Auto-approbation activée' : 'Auto-approbation désactivée')
  }
  async function review(id: number, status: ClipDTO['reviewStatus']): Promise<void> {
    await api.reviewClip(id, status)
    await onRefresh()
  }

  // Sépare les clips IA (vidéos générées depuis une idée) des clips « créateur ».
  const aiIds = new Set(sources.filter((s) => (s.url ?? '').startsWith('idea:')).map((s) => s.id))
  const isAI = (c: ClipDTO): boolean => aiIds.has(c.sourceId) || c.reason === 'Vidéo générée depuis une idée'
  // Portée : « Tous les comptes » → tout ; sinon uniquement les clips du profil choisi.
  const forProfile = (c: ClipDTO): boolean => scope === ALL_SCOPE || c.profile === scope
  const creatorClips = clips.filter((c) => !isAI(c) && forProfile(c))
  const aiClips = clips.filter((c) => isAI(c) && forProfile(c)).sort((a, b) => b.createdAt - a.createdAt)

  const groups = new Map<number, ClipDTO[]>()
  for (const c of creatorClips) {
    const arr = groups.get(c.sourceId) ?? []
    arr.push(c)
    groups.set(c.sourceId, arr)
  }
  const srcMap = new Map(sources.map((s) => [s.id, s]))
  const srcTitle = (id: number): string => {
    const s = srcMap.get(id)
    return s?.title || s?.url?.split(/[\\/]/).pop() || `Source #${id}`
  }
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 } as const
  const modalNode = modal && <PublishModal clip={modal} ttNickname={ttProfile?.nickname ?? null} onClose={() => setModal(null)} onDone={onRefresh} toast={toast} />

  // Vue détaillée d'un dossier (onglet créateur)
  if (tab === 'creator' && open !== null) {
    const list = (groups.get(open) ?? []).slice().sort((a, b) => a.startSec - b.startSec)
    return (
      <>
        <div className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn icon-btn" onClick={() => setOpen(null)} title="Retour aux dossiers">←</button>
            <div>
              <h1 style={{ fontSize: 22 }}>{srcTitle(open)}</h1>
              <p>{list.length} clip{list.length > 1 ? 's' : ''} découpé{list.length > 1 ? 's' : ''} sur cette vidéo</p>
            </div>
          </div>
        </div>
        <div style={gridStyle}>
          {list.map((c) => <ClipCard key={c.id} c={c} onReview={review} onPublish={(x) => setModal(x)} />)}
        </div>
        {modalNode}
      </>
    )
  }

  const changeTab = (t: 'creator' | 'ai'): void => { setTab(t); setOpen(null) }
  const folders = [...groups.entries()].sort((a, b) => b[0] - a[0])
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clips</h1>
          <p>Tes clips à valider et publier, séparés par type.</p>
        </div>
        <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Switch checked={autoApprove} onChange={toggleAuto} label="Auto-approuver" />
          <span className="muted small" style={{ maxWidth: 200 }}>
            Les nouveaux clips sont validés et mis en file d’attente automatiquement.
          </span>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'creator' ? 'on' : ''}`} onClick={() => changeTab('creator')}><Icon name="clips" size={16} /> Clips créateur de contenu</button>
        <button className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => changeTab('ai')}><Icon name="bulb" size={16} /> Clips IA</button>
      </div>

      {tab === 'creator' ? (
        folders.length === 0 ? (
          <div className="card muted">Aucun clip découpé pour l’instant. Va sur « Générer ».</div>
        ) : (
          <div className="folder-grid">
            {folders.map(([sid, list]) => {
              const pub = list.filter((c) => c.publishStatus === 'published').length
              return (
                <div key={sid} className="card folder" onClick={() => setOpen(sid)}>
                  <div className="fic"><Icon name="folder" /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{srcTitle(sid)}</div>
                    <div className="muted small">
                      {list.length} clip{list.length > 1 ? 's' : ''}
                      {pub > 0 ? ` · ${pub} publié${pub > 1 ? 's' : ''}` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : aiClips.length === 0 ? (
        <div className="card muted">Aucune vidéo IA. Va sur « Mes idées » et clique « 🎬 Vidéo » sur une idée.</div>
      ) : (
        <div style={gridStyle}>
          {aiClips.map((c) => <ClipCard key={c.id} c={c} onReview={review} onPublish={(x) => setModal(x)} />)}
        </div>
      )}
      {modalNode}
    </>
  )
}

function PublishModal({ clip, ttNickname, onClose, onDone, toast }: { clip: ClipDTO; ttNickname: string | null; onClose: () => void; onDone: () => Promise<void>; toast: (m: string) => void }): JSX.Element {
  const [mode, setMode] = useState<string>('export')
  const [caption, setCaption] = useState([clip.description, clip.hashtags].filter(Boolean).join(' '))
  const [privacy, setPrivacy] = useState('SELF_ONLY')
  const [opts, setOpts] = useState<string[]>([])
  const [allow, setAllow] = useState({ comment: true, duet: true, stitch: true })
  const [disabledFlags, setDisabledFlags] = useState({ comment: false, duet: false, stitch: false })
  const [commercial, setCommercial] = useState(false)
  const [brand, setBrand] = useState({ organic: false, content: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getFlag('publish_mode').then((r) => {
      const m = r.value || 'export'
      setMode(m)
      if (m === 'uploadpost') {
        setOpts(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'])
        setPrivacy('PUBLIC_TO_EVERYONE')
      } else if (m === 'tiktok') {
        api.tiktokCheck().then((info) => {
          setOpts(info.privacyOptions)
          setPrivacy(info.privacyOptions[0] ?? 'SELF_ONLY')
          setDisabledFlags({ comment: info.commentDisabled, duet: info.duetDisabled, stitch: info.stitchDisabled })
          setAllow({ comment: !info.commentDisabled, duet: !info.duetDisabled, stitch: !info.stitchDisabled })
        }).catch(() => setOpts(['SELF_ONLY']))
      }
    }).catch(() => undefined)
  }, [])

  async function publish(): Promise<void> {
    setBusy(true)
    const overrides: PublishOverrides = {
      caption,
      privacyLevel: privacy,
      disableComment: !allow.comment,
      disableDuet: !allow.duet,
      disableStitch: !allow.stitch,
      brandOrganic: commercial && brand.organic,
      brandContent: commercial && brand.content
    }
    try {
      await api.publishClip(clip.id, overrides)
      toast('Publication envoyée ✅')
      onClose()
      await onDone()
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
      setBusy(false)
    }
  }

  const privacyLabel = (o: string): string =>
    ({ PUBLIC_TO_EVERYONE: 'Public (Tout le monde)', MUTUAL_FOLLOW_FRIENDS: 'Amis', FOLLOWER_OF_CREATOR: 'Abonnés', SELF_ONLY: 'Privé (Seulement moi)' } as Record<string, string>)[o] || o

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="card" style={{ width: 720, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto', display: 'flex', gap: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 190, flexShrink: 0 }}>
          {clip.filePath ? <video src={clipUrl(clip.filePath)} controls style={{ width: 190, borderRadius: 10, background: '#000', aspectRatio: '9 / 16' }} /> : <div className="muted">Pas d'aperçu</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ marginTop: 0 }}>Vérifier &amp; publier</h3>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Compte : {ttNickname ? `@${ttNickname}` : '—'} · mode {mode === 'tiktok' ? 'Direct' : mode === 'tiktok_draft' ? 'Brouillon' : mode === 'uploadpost' ? 'upload-post' : 'Export'}
          </div>
          <label className="muted small">Légende</label>
          <textarea className="input-full" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} style={{ marginTop: 4 }} />
          {(mode === 'tiktok' || mode === 'uploadpost') && (
            <>
              <label className="muted small" style={{ display: 'block', marginTop: 10 }}>Confidentialité</label>
              <select className="input-full" value={privacy} onChange={(e) => setPrivacy(e.target.value)} style={{ marginTop: 4 }}>
                {(opts.length ? opts : ['SELF_ONLY']).map((o) => <option key={o} value={o}>{privacyLabel(o)}</option>)}
              </select>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
                {(['comment', 'duet', 'stitch'] as const).map((k) => (
                  <label key={k} className="small">
                    <input type="checkbox" checked={allow[k]} disabled={disabledFlags[k]} onChange={(e) => setAllow((a) => ({ ...a, [k]: e.target.checked }))} />{' '}
                    Autoriser {k === 'comment' ? 'les commentaires' : k === 'duet' ? 'les Duos' : 'les Stitch'}
                  </label>
                ))}
                {mode === 'tiktok' && (
                  <>
                    <label className="small" style={{ marginTop: 6 }}>
                      <input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /> Divulguer un contenu commercial
                    </label>
                    {commercial && (
                      <div style={{ marginLeft: 18 }}>
                        <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={brand.organic} onChange={(e) => setBrand((b) => ({ ...b, organic: e.target.checked }))} /> Votre marque</label>
                        <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={brand.content} onChange={(e) => setBrand((b) => ({ ...b, content: e.target.checked }))} /> Contenu de marque (tiers)</label>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          {mode === 'tiktok_draft' && <div className="muted small" style={{ marginTop: 8 }}>Brouillon : la vidéo arrive dans ta boîte de réception TikTok ; tu finalises la légende là-bas.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
            <button className="btn primary" onClick={publish} disabled={busy}>{busy ? 'Publication…' : 'Publier'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'imminent…'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const CRON_LABELS: Record<string, string> = {
  '*/5 * * * *': 'toutes les 5 min',
  '*/15 * * * *': 'toutes les 15 min',
  '*/30 * * * *': 'toutes les 30 min',
  '0 * * * *': 'toutes les heures',
  '0 */3 * * *': 'toutes les 3 h'
}

type AutopilotSlot = { user: string; handle: string | null; avatarUrl: string | null; niche: string; ordinal: number; etaHm: number; eta: string; done: boolean }
type AutopilotPlan = { enabled: boolean; perDay: number; window: { start: number; end: number }; nowHm: number; slots: AutopilotSlot[] }
type IdeaVideoMap = Record<number, { status: 'running' | 'done' | 'error'; message: string }>

// Avancement d'une génération de vidéo, de la création jusqu'au post (0→100).
function genPct(msg: string): number {
  const m = msg.match(/Sc[eè]ne (\d+)\/(\d+)/i)
  if (m) {
    const x = Number(m[1])
    const n = Number(m[2]) || 1
    const sub = /image/i.test(msg) ? 0.45 : /montage/i.test(msg) ? 0.85 : 0
    return Math.min(82, 8 + ((x - 1 + sub) / n) * 72)
  }
  if (/publi[ée]e?\b|publié sur/i.test(msg)) return 100
  if (/publication/i.test(msg)) return 96
  if (/pr[êe]te/i.test(msg)) return 93
  if (/musique/i.test(msg)) return 90
  if (/assemblage|concat/i.test(msg)) return 85
  if (/choix de la musique/i.test(msg)) return 6
  if (/storyboard|d[ée]marrage|lancement/i.test(msg)) return 3
  return 5
}

function Queue({ clips, go, scope, ideaVideo }: { clips: ClipDTO[]; go: (p: Page) => void; scope: string; ideaVideo: IdeaVideoMap }): JSX.Element {
  const [status, setStatus] = useState<{ enabled: boolean; paused: boolean; cron: string; nextRunAt: number | null; intervalSec: number | null; lastRunAt: number | null } | null>(null)
  const [plan, setPlan] = useState<AutopilotPlan | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback((): void => {
    api.schedulerStatus().then(setStatus).catch(() => undefined)
    api.autopilotPlan().then(setPlan).catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const poll = window.setInterval(load, 20000)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [load])

  // Génération en cours (pilote) : la dernière entrée « running » des événements SSE.
  const running = Object.values(ideaVideo).filter((v) => v.status === 'running')
  const activeGen = running.length ? running[running.length - 1] : null
  // Recharge le planning quand une génération démarre ou se termine (états à jour).
  const genKey = activeGen ? activeGen.message : (Object.keys(ideaVideo).length ? 'idle' : 'none')
  useEffect(() => { if (genKey === 'idle') load() }, [genKey, load])

  const slots = (plan?.slots ?? []).filter((s) => scope === ALL_SCOPE || s.user === scope)
  const doneCount = slots.filter((s) => s.done).length
  const nextIdx = slots.findIndex((s) => !s.done)

  const togglePause = async (): Promise<void> => {
    const paused = !status?.paused
    await api.setFlag('queue_paused', paused ? '1' : '0')
    load()
  }

  const queue = clips
    .filter((c) => c.reviewStatus === 'approved' && c.publishStatus !== 'published')
    .sort((a, b) => a.createdAt - b.createdAt)
  const interval = (status?.intervalSec ?? 1800) * 1000
  const next = status?.nextRunAt ?? null
  const remaining = next ? next - now : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>File d’attente</h1>
          <p>Les clips validés sont publiés automatiquement, un par un, selon ta planification.</p>
        </div>
        {status?.enabled && (
          <button className={`btn${status.paused ? ' primary' : ''}`} onClick={togglePause}>
            <Icon name={status.paused ? 'play' : 'pause'} size={16} />
            {status.paused ? 'Reprendre' : 'Mettre en pause'}
          </button>
        )}
      </div>

      {plan?.enabled && slots.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 4 }}>
            <div>
              <strong>Pilote auto — aujourd’hui</strong>
              <div className="muted small">{doneCount}/{slots.length} publiée{slots.length > 1 ? 's' : ''} · heures réelles pour les publiées, estimations (≈) pour les suivantes jusqu’à {plan.window.end}h</div>
            </div>
            <span className="pill-badge"><span className="dot" /> {plan.targetPerDay ?? plan.perDay} vidéo{(plan.targetPerDay ?? plan.perDay) > 1 ? 's' : ''}/jour</span>
          </div>
          {status?.paused && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div className="small"><b>⏸ En pause</b> — aucune vidéo n’est produite ni publiée tant que c’est en pause.</div>
              <button className="btn small" onClick={togglePause}>Reprendre</button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {slots.map((s, i) => {
              const generating = i === nextIdx && !!activeGen
              return (
                <div key={`${s.user}-${s.ordinal}`}>
                  <div className="row" style={{ gap: 12 }}>
                    <div style={{ width: 58, flexShrink: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: s.done ? 'var(--muted)' : 'var(--accent-strong)' }}>{s.done ? s.eta : `≈ ${s.eta}`}</div>
                    <Avatar url={s.avatarUrl} name={s.user} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.handle ? '@' + s.handle : s.user}</div>
                      <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.niche.split(' (')[0]}</div>
                    </div>
                    {s.done ? (
                      <span className="chip" style={{ background: '#dcfce7', color: 'var(--good)' }}>✓ publiée</span>
                    ) : generating ? (
                      <span className="chip" style={{ background: 'var(--accent-soft-2)' }}>⚙️ en création</span>
                    ) : i === nextIdx ? (
                      <span className="chip">⏳ prochaine</span>
                    ) : (
                      <span className="muted small">à venir</span>
                    )}
                  </div>
                  {generating && activeGen && (
                    <div style={{ marginTop: 8, marginLeft: 70 }}>
                      <div className="bar"><div style={{ width: `${genPct(activeGen.message)}%`, transition: 'width 0.4s ease' }} /></div>
                      <div className="muted small" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeGen.message}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!status?.enabled ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <div className="dz-icon" style={{ margin: '0 auto 12px' }}><Icon name="clock" size={24} /></div>
          <div style={{ fontWeight: 600 }}>Planification désactivée</div>
          <p className="muted small">Active la publication automatique dans les Réglages pour mettre les clips en file.</p>
          <button className="btn primary" style={{ marginTop: 6 }} onClick={() => go('settings')}>Aller aux Réglages</button>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <div>
              <div className="muted small">{status.paused ? 'Publication automatique' : 'Prochaine publication dans'}</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.5px', color: status.paused ? 'var(--muted)' : 'var(--accent-strong)' }}>
                {status.paused ? 'En pause' : queue.length ? fmtCountdown(remaining) : '—'}
              </div>
              <div className="muted small">
                {status.paused
                  ? `${queue.length} clip${queue.length > 1 ? 's' : ''} en attente · reprend quand tu veux`
                  : queue.length
                    ? `${queue.length} clip${queue.length > 1 ? 's' : ''} en attente · ${CRON_LABELS[status.cron] ?? status.cron}`
                    : `Aucun clip en attente · vérifie ${CRON_LABELS[status.cron] ?? status.cron}`}
              </div>
            </div>
            {status.paused
              ? <span className="chip">⏸ En pause</span>
              : <span className="pill-badge"><span className="dot" /> Planif active</span>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {status?.enabled && queue.length === 0 && (
          <div className="card muted">Aucun clip validé en attente. Valide des clips dans l’onglet Clips pour les mettre en file.</div>
        )}
        {queue.map((c, i) => {
          const eta = next ? next + i * interval : null
          return (
            <div key={c.id} className="card">
              <div className="row" style={{ gap: 12 }}>
                <div style={{ width: 54, flexShrink: 0 }}>
                  {c.filePath && (
                    <video src={clipUrl(c.filePath)} muted preload="metadata" style={{ width: 54, borderRadius: 8, background: '#000', aspectRatio: '9 / 16' }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
                  <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.hashtags || c.description || '—'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {i === 0 ? <span className="chip">Prochain</span> : <span className="muted" style={{ fontWeight: 600 }}>#{i + 1}</span>}
                  {eta && <div className="muted small" style={{ marginTop: 4 }}>≈ {new Date(eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

const UNKNOWN_ACCOUNT = '__unknown__'

function Published({ clips, go, scope }: { clips: ClipDTO[]; go: (p: Page) => void; scope: string }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const pub = clips.filter(
    (c) => c.publishStatus === 'published' && (scope === ALL_SCOPE || c.publishedAccount === scope || c.profile === scope)
  )

  const groups = new Map<string, ClipDTO[]>()
  for (const c of pub) {
    const key = c.publishedAccount || UNKNOWN_ACCOUNT
    const arr = groups.get(key) ?? []
    arr.push(c)
    groups.set(key, arr)
  }
  const label = (key: string): string => (key === UNKNOWN_ACCOUNT ? 'Compte inconnu' : key)

  const cardGrid = (list: ClipDTO[]): JSX.Element => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
      {list.slice().sort((a, b) => b.createdAt - a.createdAt).map((c) => (
        <div key={c.id} className="card" style={{ padding: 12 }}>
          {c.filePath ? (
            <video src={clipUrl(c.filePath)} controls style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '9 / 16' }} />
          ) : (
            <div className="muted small">Pas d’aperçu</div>
          )}
          <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14 }}>{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
          {c.hashtags && <div className="small" style={{ color: 'var(--accent)', marginTop: 2 }}>{c.hashtags}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.publishedAccount || '—'}</span>
            <span className="chip" style={{ background: '#dcfce7', color: 'var(--good)' }}>✓ publié</span>
          </div>
        </div>
      ))}
    </div>
  )

  if (pub.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>Publiés (0)</h1><p>Tes clips publiés, rangés par compte.</p></div></div>
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <div className="dz-icon" style={{ margin: '0 auto 12px' }}><Icon name="send" size={24} /></div>
          <div style={{ fontWeight: 600 }}>Aucun clip publié pour l’instant</div>
          <p className="muted small">Publie des clips depuis l’onglet Clips (ou via la planification) — ils apparaîtront ici.</p>
          <button className="btn primary" style={{ marginTop: 6 }} onClick={() => go('clips')}>Aller aux Clips</button>
        </div>
      </>
    )
  }

  if (open !== null) {
    const list = groups.get(open) ?? []
    return (
      <>
        <div className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn icon-btn" onClick={() => setOpen(null)} title="Retour aux dossiers">←</button>
            <div>
              <h1 style={{ fontSize: 22 }}>{label(open)}</h1>
              <p>{list.length} clip{list.length > 1 ? 's' : ''} publié{list.length > 1 ? 's' : ''} sur ce compte</p>
            </div>
          </div>
        </div>
        {cardGrid(list)}
      </>
    )
  }

  const folders = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  return (
    <>
      <div className="page-head"><div><h1>Publiés ({pub.length})</h1><p>Tes clips publiés, rangés par compte. Clique un dossier pour voir ses clips.</p></div></div>
      <div className="folder-grid">
        {folders.map(([key, list]) => (
          <div key={key} className="card folder" onClick={() => setOpen(key)}>
            <div className="fic"><Icon name="folder" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(key)}</div>
              <div className="muted small">{list.length} clip{list.length > 1 ? 's' : ''} publié{list.length > 1 ? 's' : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function ideaToText(i: ViralIdea): string {
  return `${i.title}\n\nHook : ${i.hook}\nAngle : ${i.angle}\n\nScript :\n${i.script
    .map((s, k) => `${k + 1}. ${s}`)
    .join('\n')}\n\nFormat : ${i.format}\n\n${i.hashtags.join(' ')}`
}

function Ideas({ toast, go }: { toast: (m: string) => void; go: (p: Page) => void }): JSX.Element {
  const [niche, setNiche] = useState('')
  const [count, setCount] = useState(4)
  const [trends, setTrends] = useState<string[]>([])
  const [trendsConfigured, setTrendsConfigured] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [saved, setSaved] = useState<SavedIdea[]>([])
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [gen, setGen] = useState<Record<number, { status: 'running' | 'done' | 'error'; message: string }>>({})

  const loadTrends = useCallback(async (): Promise<void> => {
    setTrendsLoading(true)
    try {
      const r = await api.trends()
      setTrendsConfigured(r.configured)
      setTrends(r.hashtags)
    } catch {
      setTrendsConfigured(false)
    } finally {
      setTrendsLoading(false)
    }
  }, [])
  const loadSaved = useCallback(async (): Promise<void> => {
    setLoadingSaved(true)
    try { setSaved((await api.savedIdeas()).ideas) } catch { /* ignore */ } finally { setLoadingSaved(false) }
  }, [])
  useEffect(() => { void loadTrends(); void loadSaved() }, [loadTrends, loadSaved])
  useEffect(() => {
    return subscribe({
      onIdeaVideo: (e) => {
        setGen((g) => ({ ...g, [e.ideaId]: { status: e.status, message: e.message } }))
        if (e.status === 'done') toast('Vidéo prête ✅ — retrouve-la dans Clips')
        if (e.status === 'error') toast(`Vidéo : ${e.message}`)
      }
    })
  }, [toast])

  const toggle = (t: string): void => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))

  const generate = async (): Promise<void> => {
    if (!niche.trim()) {
      toast('Indique une niche ou un thème')
      return
    }
    setLoading(true)
    try {
      const r = await api.generateIdeas(niche.trim(), count, selected)
      if (!r.ideas.length) toast('Aucune idée générée — réessaie')
      else toast(`${r.ideas.length} idées générées ✓`)
      await loadSaved()
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string): void => {
    navigator.clipboard?.writeText(text)
    toast('Copié ✓')
  }
  const genVideo = async (id: number): Promise<void> => {
    setGen((g) => ({ ...g, [id]: { status: 'running', message: 'Lancement…' } }))
    try {
      await api.generateIdeaVideo(id)
    } catch (e) {
      setGen((g) => ({ ...g, [id]: { status: 'error', message: String((e as Error).message) } }))
    }
  }
  const del = async (id: number): Promise<void> => {
    await api.deleteIdea(id)
    setSaved((xs) => xs.filter((x) => x.id !== id))
    toast('Idée supprimée')
  }
  const fmtDate = (ts: number): string => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Idées virales</h1>
          <p>Génère des idées et scripts de vidéos par IA, ancrés sur les tendances TikTok. Toutes tes idées sont enregistrées ci-dessous.</p>
        </div>
        <button className="btn" onClick={loadSaved} disabled={loadingSaved}><Icon name="refresh" size={15} /> Actualiser</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>Tendances TikTok</h3>
          <button className="btn" onClick={loadTrends} disabled={trendsLoading}>
            <Icon name="refresh" size={15} /> {trendsLoading ? '…' : 'Actualiser'}
          </button>
        </div>
        {trendsConfigured === false ? (
          <div style={{ marginTop: 8 }}>
            <p className="muted small">
              Pour afficher les vraies tendances TikTok, abonne-toi à une API de tendances sur RapidAPI (ta clé
              RapidAPI existante fonctionnera). Tu peux déjà générer des idées ci-dessous, ou cibler des tendances
              à la main dans la niche.
            </p>
            <button className="btn" onClick={() => go('settings')}>Aller aux Réglages</button>
          </div>
        ) : trends.length === 0 ? (
          <p className="muted small" style={{ marginBottom: 0, marginTop: 8 }}>Aucune tendance récupérée pour l’instant.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 8 }}>
              Clique des tendances pour ancrer tes idées dessus ({selected.length} sélectionnée{selected.length > 1 ? 's' : ''}).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {trends.map((t) => (
                <button
                  key={t}
                  className="chip"
                  onClick={() => toggle(t)}
                  style={{ cursor: 'pointer', border: selected.includes(t) ? '1px solid var(--accent)' : '1px solid transparent', background: selected.includes(t) ? 'var(--accent-soft-2)' : undefined }}
                >
                  #{t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="muted small" style={{ display: 'block', marginBottom: 6 }}>Niche / thème</label>
            <input className="input-full" placeholder="ex. gaming FIFA, coulisses de concerts, humour du quotidien…" value={niche} onChange={(e) => setNiche(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void generate()} />
          </div>
          <div>
            <label className="muted small" style={{ display: 'block', marginBottom: 6 }}>Nombre</label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} idées</option>)}
            </select>
          </div>
          <button className="btn primary" onClick={generate} disabled={loading}>
            <Icon name="spark" size={15} /> {loading ? 'Génération…' : 'Générer'}
          </button>
        </div>
      </div>

      <h3 style={{ margin: '0 2px 12px' }}>Mes idées ({saved.length})</h3>
      {loadingSaved ? (
        <div className="card muted">Chargement…</div>
      ) : saved.length === 0 ? (
        <div className="card muted">Aucune idée pour l’instant — entre une niche ci-dessus et clique « Générer ».</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {saved.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              meta={`${idea.niche} · ${fmtDate(idea.createdAt)}`}
              onCopy={() => copy(ideaToText(idea))}
              onDelete={() => del(idea.id)}
              onGenVideo={() => genVideo(idea.id)}
              gen={gen[idea.id]}
            />
          ))}
        </div>
      )}
    </>
  )
}

function IdeaCard({ idea, onCopy, meta, onDelete, onGenVideo, gen }: { idea: ViralIdea; onCopy: () => void; meta?: string; onDelete?: () => void; onGenVideo?: () => void; gen?: { status: 'running' | 'done' | 'error'; message: string } }): JSX.Element {
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {meta && <div className="muted small" style={{ marginBottom: 2 }}>{meta}</div>}
          <div style={{ fontWeight: 700, fontSize: 16 }}>{idea.title}</div>
          <div className="small" style={{ marginTop: 4 }}><b>Hook :</b> {idea.hook}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {onGenVideo && <button className="btn primary small" onClick={onGenVideo} disabled={gen?.status === 'running'}>{gen?.status === 'running' ? 'Génération…' : '🎬 Vidéo'}</button>}
          <button className="btn small" onClick={onCopy}>Copier</button>
          {onDelete && <button className="btn small" onClick={onDelete} title="Supprimer">🗑</button>}
        </div>
      </div>
      {gen && (
        <div className="small" style={{ marginTop: 8, fontWeight: 600, color: gen.status === 'error' ? '#b91c1c' : gen.status === 'done' ? 'var(--good)' : 'var(--accent-strong)' }}>
          {gen.status === 'running' ? '⏳ ' : gen.status === 'done' ? '✅ ' : '⚠️ '}{gen.message}
        </div>
      )}
      <div className="muted small" style={{ marginTop: 6 }}><b>Pourquoi ça marche :</b> {idea.angle}</div>
      <div style={{ marginTop: 8 }}>
        <div className="muted small" style={{ fontWeight: 600 }}>Script</div>
        <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {idea.script.map((s, j) => <li key={j} className="small" style={{ marginBottom: 2 }}>{s}</li>)}
        </ol>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}><b>Format :</b> {idea.format}</div>
      {idea.hashtags.length > 0 && <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>{idea.hashtags.join(' ')}</div>}
    </div>
  )
}

type AnalyticsProfile = { profile: string; handle: string | null; avatarUrl: string | null; followers: number; views: number; likes: number; comments: number; shares: number; videoCount: number; timeseries: { date: string; value: number }[] }

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k'
  return String(n)
}
function Sparkline({ data }: { data: number[] }): JSX.Element | null {
  if (data.length < 2) return null
  const w = 120, h = 34, max = Math.max(1, ...data)
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Pilote automatique : contenu quotidien autonome par compte ──
type SeriesCfg = { enabled: boolean; title: string; universe: string; episode: number }
type AutopilotProfile = { username: string; handle: string | null; avatarUrl: string | null; niche: string; cta: string; perDay: number; series: SeriesCfg; doneToday: number }
type AutopilotState = { enabled: boolean; perDay: number; busy: boolean; profiles: AutopilotProfile[] }

function Autopilot({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [state, setState] = useState<AutopilotState | null>(null)
  const [niches, setNiches] = useState<Record<string, string>>({})
  const [ctas, setCtas] = useState<Record<string, string>>({})
  const [series, setSeries] = useState<Record<string, SeriesCfg>>({})
  const [perDays, setPerDays] = useState<Record<string, number>>({})
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const s = await api.autopilotState()
      setState(s)
      setEnabled(s.enabled)
      const n: Record<string, string> = {}
      const c: Record<string, string> = {}
      const sr: Record<string, SeriesCfg> = {}
      const pd: Record<string, number> = {}
      s.profiles.forEach((p) => { n[p.username] = p.niche; c[p.username] = p.cta; sr[p.username] = p.series; pd[p.username] = p.perDay })
      setNiches(n)
      setCtas(c)
      setSeries(sr)
      setPerDays(pd)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const setSerie = (u: string, patch: Partial<SeriesCfg>): void =>
    setSeries((m) => ({ ...m, [u]: { enabled: false, title: '', universe: '', episode: 1, ...m[u], ...patch } }))

  const save = async (over?: { enabled?: boolean }): Promise<void> => {
    setSaving(true)
    try {
      const seriesOut: Record<string, { enabled: boolean; title: string; universe: string }> = {}
      for (const [u, s] of Object.entries(series)) seriesOut[u] = { enabled: s.enabled, title: s.title, universe: s.universe }
      await api.saveAutopilot({ enabled: over?.enabled ?? enabled, perDays, niches, ctas, series: seriesOut })
      toast('Pilote auto enregistré')
      await load()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const toggle = async (): Promise<void> => { const v = !enabled; setEnabled(v); await save({ enabled: v }) }
  const runNow = async (): Promise<void> => {
    try { await api.runAutopilotNow(); toast('Cycle lancé — suis la progression en bas à droite'); window.setTimeout(() => void load(), 1500) }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }

  const profiles = state?.profiles ?? []
  // Total effectif par jour (les séries sont plafonnées à 1 épisode/jour).
  const totalPerDay = profiles.reduce((s, p) => {
    const pd = perDays[p.username] ?? p.perDay
    return s + (series[p.username]?.enabled ? Math.min(pd, 1) : pd)
  }, 0)

  return (
    <>
      <div className="page-head">
        <div><h1>Pilote automatique</h1><p>Chaque jour, du contenu adapté à chaque compte selon sa niche — généré et publié sans intervention.</p></div>
        <button className="btn" onClick={() => void load()}><Icon name="refresh" size={15} /> Actualiser</button>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, borderColor: enabled ? 'var(--accent)' : undefined }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{enabled ? '🟢 Pilote actif' : '⚪ Pilote en pause'}</div>
          <div className="muted small">{enabled ? `Génère et publie automatiquement selon la cadence de chaque compte — ${totalPerDay} vidéo${totalPerDay > 1 ? 's' : ''}/jour au total.` : 'Active-le pour lancer la production quotidienne 100% autonome.'}</div>
        </div>
        <button className={`btn ${enabled ? '' : 'primary'}`} disabled={saving} onClick={toggle}>{enabled ? 'Désactiver' : 'Activer'}</button>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Cadence, niche &amp; CTA par compte</div>
        <div className="muted small" style={{ marginBottom: 12 }}>
          Règle le nombre de <b>vidéos/jour</b> compte par compte (0 = compte en pause). La publication est étalée de 9h à 23h. Le <b>CTA</b> est ajouté automatiquement à la fin de <b>chaque légende</b> publiée sur ce compte.
        </div>
        {profiles.length === 0 ? (
          <div className="muted">Aucun compte upload-post connecté. Ajoute-les dans Réglages.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {profiles.map((p) => (
              <div key={p.username} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <Avatar url={p.avatarUrl} name={p.username} size={38} />
                <div style={{ width: 120, minWidth: 0, paddingTop: 4 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.handle ? '@' + p.handle : p.username}</div>
                  <div className="muted small">{p.doneToday} publiée{p.doneToday > 1 ? 's' : ''} auj.</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="muted small" style={{ whiteSpace: 'nowrap' }}>Vidéos / jour :</span>
                    <select value={perDays[p.username] ?? p.perDay} onChange={(e) => setPerDays((m) => ({ ...m, [p.username]: Number(e.target.value) }))}>
                      <option value={0}>0 — en pause</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {series[p.username]?.enabled && (perDays[p.username] ?? p.perDay) > 1 && (
                      <span className="muted small">série : plafonné à 1/jour</span>
                    )}
                  </div>
                  <input className="input-full" value={niches[p.username] ?? ''} placeholder="Niche — ex. mystères non résolus…" onChange={(e) => setNiches((m) => ({ ...m, [p.username]: e.target.value }))} />
                  <input className="input-full" value={ctas[p.username] ?? ''} placeholder="CTA ajouté aux légendes — ex. 🔗 Mon guide gratuit est dans la bio" onChange={(e) => setCtas((m) => ({ ...m, [p.username]: e.target.value }))} />
                  <label className="switch" style={{ marginTop: 4 }}>
                    <input type="checkbox" checked={!!series[p.username]?.enabled} onChange={(e) => setSerie(p.username, { enabled: e.target.checked })} />
                    <span className="track" />
                    Mode série (feuilleton à épisodes)
                    {series[p.username]?.enabled && <span className="chip" style={{ marginLeft: 6 }}>Ép. {series[p.username]?.episode ?? 1}</span>}
                  </label>
                  {series[p.username]?.enabled && (
                    <>
                      <input className="input-full" value={series[p.username]?.title ?? ''} placeholder="Titre de la série — ex. L’île des fruits skibidi" onChange={(e) => setSerie(p.username, { title: e.target.value })} />
                      <textarea className="input-full" rows={3} value={series[p.username]?.universe ?? ''} placeholder="Univers : personnages récurrents + style visuel — ex. Des fruits en 3D style Pixar coincés sur une île volcanique : Bano la banane à lunettes (le chef), Fraisou la fraise peureuse, Nanas l’ananas musclé. Humour absurde « skibidi », couleurs saturées." onChange={(e) => setSerie(p.username, { universe: e.target.value })} />
                      <div className="muted small">La série remplace la niche sur ce compte : chaque vidéo = l’épisode suivant de l’histoire (mémoire conservée, cliffhanger à chaque fin). Cadence fixée à <b>1 épisode/jour</b> (scènes animées en vidéo si la clé fal.ai est configurée). Changer le titre relance une histoire à l’épisode 1.</div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          <button className="btn" disabled={!!state?.busy} onClick={() => void runNow()} title="Génère et publie 1 vidéo maintenant (test)">
            <Icon name="bolt" size={15} /> {state?.busy ? 'Génération en cours…' : 'Tester maintenant'}
          </button>
        </div>
      </div>
    </>
  )
}

type PostStat = { clipId: number; title: string | null; filePath: string | null; postUrl: string | null; createdAt: number; views: number; likes: number; comments: number; shares: number }

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="muted small" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function Settings({ toast, onTtProfile }: { toast: (m: string) => void; onTtProfile: (p: { nickname: string | null; avatarUrl: string | null }) => void }): JSX.Element {
  const [flags, setFlags] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<{ has: boolean; masked: string | null }>({ has: false, masked: null })
  const [groqKey, setGroqKey] = useState('')
  const [groqHas, setGroqHas] = useState(false)
  const [rapidKey, setRapidKey] = useState('')
  const [rapidHas, setRapidHas] = useState(false)
  const [upKey, setUpKey] = useState('')
  const [upHas, setUpHas] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiHas, setOpenaiHas] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiHas, setGeminiHas] = useState(false)
  const [falKey, setFalKey] = useState('')
  const [falHas, setFalHas] = useState(false)
  const [music, setMusic] = useState<string[]>([])
  const [upProfiles, setUpProfiles] = useState<{ username: string; tiktokHandle: string | null; tiktokConnected: boolean; reauthRequired: boolean; blocked: boolean }[]>([])
  const [upSelected, setUpSelected] = useState<string[]>([])
  const [upLoading, setUpLoading] = useState(false)
  const [tt, setTt] = useState<{ connected: boolean; hasConfig: boolean; hasSecret: boolean } | null>(null)
  const [ttCode, setTtCode] = useState('')
  const [secret, setSecret] = useState('')

  const loadFlag = useCallback(async (k: string) => {
    const r = await api.getFlag(k)
    setFlags((f) => ({ ...f, [k]: r.value ?? '' }))
  }, [])
  useEffect(() => {
    ;['publish_mode', 'highlights_model', 'script_model', 'transcribe_enabled', 'transcribe_backend', 'reframe_focus', 'tiktok_privacy', 'tiktok_client_key', 'tiktok_redirect', 'schedule_enabled', 'schedule_cron', 'uploadpost_user', 'uploadpost_users', 'uploadpost_fallback'].forEach((k) => loadFlag(k).catch(() => undefined))
    api.apiKeyStatus().then(setKeyStatus).catch(() => undefined)
    api.groqStatus().then((r) => setGroqHas(r.has)).catch(() => undefined)
    api.rapidApiStatus().then((r) => setRapidHas(r.has)).catch(() => undefined)
    api.uploadPostStatus().then((r) => setUpHas(r.has)).catch(() => undefined)
    api.openaiStatus().then((r) => setOpenaiHas(r.has)).catch(() => undefined)
    api.geminiStatus().then((r) => setGeminiHas(r.has)).catch(() => undefined)
    api.falStatus().then((r) => setFalHas(r.has)).catch(() => undefined)
    api.musicList().then((r) => setMusic(r.tracks)).catch(() => undefined)
    api.golinks().then((r) => setLinks(Object.entries(r.links).map(([slug, url]) => ({ slug, url })))).catch(() => undefined)
    api.tiktokStatus().then(setTt).catch(() => undefined)
  }, [loadFlag])

  const setFlag = async (k: string, v: string): Promise<void> => {
    setFlags((f) => ({ ...f, [k]: v }))
    await api.setFlag(k, v)
    if (k === 'schedule_enabled' || k === 'schedule_cron') await api.reloadScheduler()
  }

  // Synchronise la sélection de comptes avec ce qui est enregistré (uploadpost_users, sinon l'ancien champ unique)
  useEffect(() => {
    let sel: string[] = []
    if (flags.uploadpost_users) {
      try {
        const a = JSON.parse(flags.uploadpost_users)
        if (Array.isArray(a)) sel = a.filter((x) => typeof x === 'string')
      } catch {
        /* ignore */
      }
    }
    if (!sel.length && flags.uploadpost_user) sel = [flags.uploadpost_user]
    setUpSelected(sel)
  }, [flags.uploadpost_users, flags.uploadpost_user])

  // Liens courts publics (bio TikTok) : slug → URL de redirection (affiliés…)
  const [links, setLinks] = useState<{ slug: string; url: string }[]>([])
  const saveLinks = async (): Promise<void> => {
    const map: Record<string, string> = {}
    for (const l of links) {
      if (l.slug.trim() && l.url.trim()) map[l.slug.trim().toLowerCase()] = l.url.trim()
    }
    try {
      const r = await api.saveGolinks(map)
      setLinks(Object.entries(r.links).map(([slug, url]) => ({ slug, url })))
      toast('Liens courts enregistrés')
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    }
  }

  const fetchProfiles = async (): Promise<void> => {
    setUpLoading(true)
    try {
      const r = await api.uploadPostProfiles()
      setUpProfiles(r.profiles)
    } catch (e) {
      toast(`upload-post : ${String((e as Error).message)}`)
    } finally {
      setUpLoading(false)
    }
  }
  const toggleProfile = (u: string): void =>
    setUpSelected((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]))

  return (
    <>
      <div className="page-head"><div><h1>Réglages</h1><p>Clés, modèle IA, transcription, recadrage, publication et planification.</p></div></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>IA (Claude)</h3>
        <Field label={keyStatus.has ? `Clé configurée ✓ (${keyStatus.masked})` : 'Clé API Anthropic'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="sk-ant-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setApiKey(apiKey); setApiKey(''); setKeyStatus(await api.apiKeyStatus()); toast('Clé enregistrée') }} disabled={!apiKey.trim()}>Enregistrer</button>
          </div>
        </Field>
        <Field label="Modèle (sélection des moments)">
          <select value={flags.highlights_model || 'haiku'} onChange={(e) => setFlag('highlights_model', e.target.value)}>
            <option value="haiku">Haiku 4.5 — éco</option>
            <option value="sonnet">Sonnet 4.6 — équilibré</option>
            <option value="opus">Opus 4.8 — max</option>
          </select>
        </Field>
        <Field label="Modèle des scénarios (idées, épisodes de série, storyboards)">
          <select value={flags.script_model || flags.highlights_model || 'haiku'} onChange={(e) => setFlag('script_model', e.target.value)}>
            <option value="haiku">Haiku 4.5 — éco</option>
            <option value="sonnet">Sonnet 4.6 — équilibré</option>
            <option value="opus">Opus 4.8 — max (meilleure écriture, ~+0,06 $/vidéo)</option>
          </select>
        </Field>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Téléchargement des vidéos (URL YouTube)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Sur le serveur, YouTube bloque le téléchargement direct. Avec une clé RapidAPI
          (API « YouTube Media Downloader »), l'onglet URL télécharge la vidéo via l'API,
          sans cookies ni navigateur.
        </p>
        <Field label={rapidHas ? 'Clé RapidAPI configurée ✓' : 'Clé RapidAPI'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="x-rapidapi-key…" value={rapidKey} onChange={(e) => setRapidKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setRapidApiKey(rapidKey); setRapidKey(''); setRapidHas((await api.rapidApiStatus()).has); toast('Clé RapidAPI enregistrée') }} disabled={!rapidKey.trim()}>Enregistrer</button>
          </div>
        </Field>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Génération de vidéos (IA)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Transforme tes idées (page « Mes idées ») en vidéos verticales : voix off + images IA + sous-titres.
          Nécessite une clé <b>OpenAI</b> (voix off TTS + images DALL·E). Coût ~0,20–0,40 € par vidéo.
        </p>
        <Field label={openaiHas ? 'Clé OpenAI configurée ✓' : 'Clé OpenAI'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="sk-…" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setOpenaiKey(openaiKey); setOpenaiKey(''); setOpenaiHas((await api.openaiStatus()).has); toast('Clé OpenAI enregistrée') }} disabled={!openaiKey.trim()}>Enregistrer</button>
          </div>
        </Field>
        <Field label={geminiHas ? 'Clé Gemini / Nano Banana configurée ✓' : 'Clé Gemini / Nano Banana (mode série)'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="AIza…  (aistudio.google.com/apikey)" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setGeminiKey(geminiKey); setGeminiKey(''); setGeminiHas((await api.geminiStatus()).has); toast('Clé Gemini enregistrée') }} disabled={!geminiKey.trim()}>Enregistrer</button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Utilisée pour les séries (feuilletons) : personnages identiques d’un épisode à l’autre grâce à une planche de référence. Sans clé, repli sur les images OpenAI (personnages moins constants).</div>
        </Field>
        <Field label={falHas ? 'Clé fal.ai configurée ✓' : 'Clé fal.ai (animation vidéo des séries)'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="clé fal.ai…  (fal.ai → Dashboard → Keys)" value={falKey} onChange={(e) => setFalKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setFalKey(falKey); setFalKey(''); setFalHas((await api.falStatus()).has); toast('Clé fal.ai enregistrée') }} disabled={!falKey.trim()}>Enregistrer</button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Anime chaque scène des épisodes de série (image → clip vidéo, ~0,18 $/scène). Sans clé, les scènes restent des images animées (zoom).</div>
        </Field>
        <Field label="Musiques de fond (libres de droits)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="btn" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
              <Icon name="upload" size={15} /> Ajouter une musique
              <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return
                try { await api.uploadMusic(f); setMusic((await api.musicList()).tracks); toast('Musique ajoutée') }
                catch (err) { toast(`Erreur : ${String((err as Error).message)}`) }
                e.target.value = ''
              }} />
            </label>
            {music.length === 0 ? (
              <span className="muted small">Aucune musique. Ajoute des pistes libres de droits : Cliperr en met une (au hasard) sous la voix off, à volume réduit.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {music.map((m) => (
                  <div key={m} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="play" size={12} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.replace(/^\d+-/, '')}</span>
                    <button className="btn small" onClick={async () => { await api.deleteMusic(m); setMusic((await api.musicList()).tracks); toast('Musique supprimée') }} title="Supprimer">🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Liens courts (bio TikTok)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Adresses courtes <b>publiques</b> qui redirigent vers tes liens (affiliés…) : <b>cliperr.juleslecorre.fr/nom</b>.
          À écrire dans le <b>texte de bio</b> tant que le lien cliquable n’est pas débloqué (~1 000 abonnés). La commission est préservée.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input style={{ width: 150 }} placeholder="nom (ex. mystere)" value={l.slug} onChange={(e) => setLinks((xs) => xs.map((x, j) => (j === i ? { ...x, slug: e.target.value } : x)))} />
              <input className="input-full" style={{ flex: 1 }} placeholder="https://amzn.to/…" value={l.url} onChange={(e) => setLinks((xs) => xs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <button className="btn small" title="Supprimer" onClick={() => setLinks((xs) => xs.filter((_, j) => j !== i))}>🗑</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={() => setLinks((xs) => [...xs, { slug: '', url: '' }])}>+ Ajouter</button>
          <button className="btn primary" onClick={() => void saveLinks()}>Enregistrer</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Transcription &amp; recadrage</h3>
        <Field label="Transcription + sous-titres">
          <label className="small"><input type="checkbox" checked={flags.transcribe_enabled === '1'} onChange={(e) => setFlag('transcribe_enabled', e.target.checked ? '1' : '0')} /> Activer</label>
        </Field>
        <Field label="Moteur de transcription">
          <select value={flags.transcribe_backend || 'groq'} onChange={(e) => setFlag('transcribe_backend', e.target.value)}>
            <option value="groq">Cloud Groq (rapide, clé requise)</option>
            <option value="local">Local whisper.cpp (Windows seulement)</option>
          </select>
        </Field>
        <Field label={groqHas ? 'Clé Groq configurée ✓' : 'Clé Groq'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="gsk_…" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} />
            <button className="btn" onClick={async () => { await api.setGroqKey(groqKey); setGroqKey(''); setGroqHas((await api.groqStatus()).has); toast('Clé Groq enregistrée') }} disabled={!groqKey.trim()}>Enregistrer</button>
          </div>
        </Field>
        <Field label="Recadrage 9:16">
          <select value={flags.reframe_focus || 'center'} onChange={(e) => setFlag('reframe_focus', e.target.value)}>
            <option value="center">Centré</option>
            <option value="left">Gauche</option>
            <option value="right">Droite</option>
            <option value="face">Visage auto</option>
          </select>
        </Field>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Publication</h3>
        <Field label="Mode">
          <select value={flags.publish_mode || 'export'} onChange={(e) => setFlag('publish_mode', e.target.value)}>
            <option value="export">Export dossier</option>
            <option value="tiktok_draft">Brouillon TikTok</option>
            <option value="tiktok">Direct TikTok (compte privé / app auditée)</option>
            <option value="uploadpost">upload-post — public, sans audit (payant)</option>
          </select>
        </Field>
        {flags.publish_mode === 'uploadpost' && (
          <>
            <p className="small" style={{ marginTop: 0 }}>
              Publie en <b>public</b> via l'app auditée d'upload-post (pas d'audit TikTok à passer).
              Nécessite un plan payant upload-post (TikTok non inclus dans l'offre gratuite). Connecte
              ton compte TikTok sur upload-post, puis renseigne la clé API et l'identifiant de profil.
            </p>
            <Field label={upHas ? 'Clé API upload-post configurée ✓' : 'Clé API upload-post'}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-full" style={{ flex: 1 }} type="password" placeholder="Apikey…" value={upKey} onChange={(e) => setUpKey(e.target.value)} />
                <button className="btn primary" onClick={async () => { await api.setUploadPostKey(upKey); setUpKey(''); setUpHas((await api.uploadPostStatus()).has); toast('Clé upload-post enregistrée') }} disabled={!upKey.trim()}>Enregistrer</button>
              </div>
            </Field>
            <Field label="Comptes TikTok à utiliser (multi-comptes)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={fetchProfiles} disabled={upLoading || !upHas}>{upLoading ? 'Chargement…' : 'Récupérer mes comptes'}</button>
                  <button className="btn primary" onClick={() => setFlag('uploadpost_users', JSON.stringify(upSelected))}>Enregistrer ({upSelected.length})</button>
                </div>
                {upProfiles.length === 0 ? (
                  <div className="muted small">
                    {upSelected.length ? `Comptes enregistrés : ${upSelected.join(', ')}. ` : ''}
                    Clique « Récupérer mes comptes » pour lister tes profils upload-post et cocher ceux à utiliser.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {upProfiles.map((p) => (
                      <label key={p.username} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={upSelected.includes(p.username)} onChange={() => toggleProfile(p.username)} />
                        <b>{p.username}</b>
                        {p.tiktokConnected
                          ? <span className="muted">· @{p.tiktokHandle}{p.reauthRequired ? ' ⚠️ ré-autorisation requise' : ''}</span>
                          : <span className="muted">· ⚠️ TikTok non connecté</span>}
                        {p.blocked && <span className="muted">· 🚫 bloqué</span>}
                      </label>
                    ))}
                  </div>
                )}
                <div className="muted small">Les comptes cochés sont disponibles dans la file d'attente (choix « Optimisé » ou compte précis) et pour la publication manuelle.</div>
              </div>
            </Field>
          </>
        )}
        <Field label="Confidentialité (Direct)">
          <select value={flags.tiktok_privacy || 'SELF_ONLY'} onChange={(e) => setFlag('tiktok_privacy', e.target.value)}>
            <option value="SELF_ONLY">Privé (Seulement moi)</option>
            <option value="PUBLIC_TO_EVERYONE">Public (app auditée)</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">Amis</option>
          </select>
        </Field>
        <Field label="TikTok — clé client">
          <input className="input-full" value={flags.tiktok_client_key || ''} onChange={(e) => setFlag('tiktok_client_key', e.target.value)} placeholder="client key" />
        </Field>
        <Field label="TikTok — redirect URI">
          <input className="input-full" value={flags.tiktok_redirect || ''} onChange={(e) => setFlag('tiktok_redirect', e.target.value)} placeholder="https://ton-domaine/api/tiktok/callback" />
        </Field>
        <Field label={tt?.hasSecret ? 'Client secret configuré ✓' : 'TikTok — client secret'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <button className="btn" onClick={async () => { await api.tiktokSetSecret(secret); setSecret(''); setTt(await api.tiktokStatus()); toast('Secret enregistré') }} disabled={!secret.trim()}>Enregistrer</button>
          </div>
        </Field>
        <Field label={`Connexion TikTok — ${tt?.connected ? 'connecté ✓' : 'non connecté'}`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => { const r = await api.tiktokAuthUrl(); window.open(r.url, '_blank') }} disabled={!tt?.hasConfig}>1) Ouvrir l'autorisation</button>
            <input className="input-full" style={{ flex: 1, minWidth: 200 }} placeholder="2) Colle le code / l'URL" value={ttCode} onChange={(e) => setTtCode(e.target.value)} />
            <button className="btn primary" onClick={async () => { try { await api.tiktokSubmitCode(ttCode); setTtCode(''); setTt(await api.tiktokStatus()); const p = await api.tiktokProfile(); onTtProfile(p); toast('TikTok connecté ✅') } catch (e) { toast(`Erreur : ${String((e as Error).message)}`) } }} disabled={!ttCode.trim()}>Valider</button>
            <button className="btn" onClick={async () => { try { const i = await api.tiktokCheck(); toast(`@${i.nickname} · confidentialités : ${i.privacyOptions.join(', ') || 'n/a'}`) } catch (e) { toast(String((e as Error).message)) } }} disabled={!tt?.connected}>Vérifier le compte</button>
          </div>
        </Field>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Planification</h3>
        <Field label="Publication automatique des clips validés">
          <label className="small"><input type="checkbox" checked={flags.schedule_enabled === '1'} onChange={(e) => setFlag('schedule_enabled', e.target.checked ? '1' : '0')} /> Activer</label>
        </Field>
        <Field label="Fréquence">
          <select value={flags.schedule_cron || '*/30 * * * *'} onChange={(e) => setFlag('schedule_cron', e.target.value)} disabled={flags.schedule_enabled !== '1'}>
            <option value="*/5 * * * *">Toutes les 5 min</option>
            <option value="*/15 * * * *">Toutes les 15 min</option>
            <option value="*/30 * * * *">Toutes les 30 min</option>
            <option value="0 * * * *">Toutes les heures</option>
            <option value="0 */3 * * *">Toutes les 3 h</option>
          </select>
        </Field>
      </div>
    </>
  )
}
