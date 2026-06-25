import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  api,
  subscribe,
  clipUrl,
  type SourceDTO,
  type ClipDTO,
  type ProgressEvent,
  type PublishOverrides
} from './api'

type Page = 'dashboard' | 'sources' | 'clips' | 'settings'

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sources: 'M12 3l9 4-9 4-9-4 9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  clips: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M16 9h4M4 15h4M16 15h4',
  settings: 'M10.3 3.2a1 1 0 011.4 0l1 1a1 1 0 00.9.3l1.4-.2a1 1 0 011 .6l.6 1.3a1 1 0 00.7.6l1.3.3a1 1 0 01.8 1.1l-.2 1.4a1 1 0 00.3.9l1 1a1 1 0 010 1.4l-1 1a1 1 0 00-.3.9l.2 1.4M12 9a3 3 0 100 6 3 3 0 000-6z',
  logout: 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  play: 'M5 3l14 9-14 9z'
}
function Icon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name] ?? ''} />
    </svg>
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
          <span className="logo">T</span> TikTokClip
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
      onLog: (m) => pushLog(m),
      onProgress: (e: ProgressEvent) => {
        pushLog(`[${e.stage}] ${e.status} ${Math.round((e.progress || 0) * 100)}%${e.message ? ' — ' + e.message : ''}`)
        if (e.status === 'done' || e.status === 'error') refresh().catch(() => undefined)
      }
    })
    return unsub
  }, [refresh, pushLog])

  const showToast = (m: string): void => {
    setToast(m)
    window.setTimeout(() => setToast(''), 3500)
  }

  const nav: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
    { id: 'sources', label: 'Sources', icon: 'sources' },
    { id: 'clips', label: 'Clips', icon: 'clips' },
    { id: 'settings', label: 'Réglages', icon: 'settings' }
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="logo">T</span> TikTokClip</div>
        {nav.map((n) => (
          <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            <Icon name={n.icon} /> {n.label}
          </button>
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
        {page === 'dashboard' && <Dashboard sources={sources} clips={clips} log={log} go={setPage} onRefresh={refresh} />}
        {page === 'sources' && <Sources sources={sources} onRefresh={refresh} toast={showToast} goClips={() => setPage('clips')} />}
        {page === 'clips' && <Clips clips={clips} onRefresh={refresh} toast={showToast} ttProfile={ttProfile} />}
        {page === 'settings' && <Settings toast={showToast} onTtProfile={setTtProfile} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="card stat">
      <div className="icon"><Icon name={icon} /></div>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="muted small" style={{ marginTop: 10 }}>{sub}</div>}
    </div>
  )
}

function Dashboard({ sources, clips, log, go, onRefresh }: { sources: SourceDTO[]; clips: ClipDTO[]; log: string[]; go: (p: Page) => void; onRefresh: () => Promise<void> }): JSX.Element {
  const [spend, setSpend] = useState<{ usd: number; inTokens: number; outTokens: number } | null>(null)
  useEffect(() => {
    api.spend().then(setSpend).catch(() => undefined)
  }, [])
  const generated = clips.length
  const approved = clips.filter((c) => c.reviewStatus === 'approved').length
  const published = clips.filter((c) => c.publishStatus === 'published').length
  const funnel = [
    { label: 'Sources', n: sources.length, icon: 'sources' },
    { label: 'Clips générés', n: generated, icon: 'clips' },
    { label: 'Clips validés', n: approved, icon: 'clips' },
    { label: 'Publiés', n: published, icon: 'upload' }
  ]
  const max = Math.max(1, ...funnel.map((f) => f.n))
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>Vue d'ensemble de ton pipeline de clipping en temps réel.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => onRefresh()}>↻ Rafraîchir</button>
          <button className="btn primary" onClick={() => go('sources')}>+ Nouvelle source</button>
        </div>
      </div>

      <div className="grid-3">
        <StatCard icon="sources" label="Sources" value={String(sources.length)} sub={`${sources.filter((s) => s.status === 'done').length} traitées · ${sources.filter((s) => s.status === 'running').length} en cours`} />
        <StatCard icon="clips" label="Clips générés" value={String(generated)} sub={`${approved} validés · ${published} publiés`} />
        <StatCard icon="settings" label="Dépense API (estim.)" value={spend ? `$${spend.usd.toFixed(4)}` : '—'} sub={spend ? `${spend.inTokens} in / ${spend.outTokens} out` : ''} />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <strong>Activité en direct</strong>
            <span className="chip">SSE</span>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--muted)', maxHeight: 320, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace' }}>
            {log.join('\n') || 'En attente…'}
          </pre>
        </div>
        <div className="card">
          <strong>Funnel de conversion</strong>
          <p className="muted small" style={{ marginTop: 2 }}>Du source au clip publié</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            {funnel.map((f) => (
              <div key={f.label}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{f.label}</span>
                  <span className="small muted">{f.n}</span>
                </div>
                <div className="bar"><div style={{ width: `${(f.n / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function Sources({ sources, onRefresh, toast, goClips }: { sources: SourceDTO[]; onRefresh: () => Promise<void>; toast: (m: string) => void; goClips: () => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function addUrl(): Promise<void> {
    if (!url.trim()) return
    setBusy(true)
    try {
      await api.addSource(url.trim())
      setUrl('')
      await onRefresh()
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    } finally {
      setBusy(false)
    }
  }
  async function onFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadPct(0)
    try {
      await api.uploadSource(file, (r) => setUploadPct(Math.round(r * 100)))
      await onRefresh()
      toast('Vidéo importée ✅')
    } catch (err) {
      toast(`Upload échoué : ${String((err as Error).message)}`)
    } finally {
      setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function run(id: number): Promise<void> {
    try {
      await api.runPipeline(id, counts[id] ?? 3)
      await onRefresh()
      toast('Pipeline lancé')
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Importe une vidéo (recommandé sur serveur) ou colle une URL.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input className="input-full" style={{ flex: 1, minWidth: 260 }} placeholder="URL YouTube / Twitch…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
          <button className="btn primary" onClick={addUrl} disabled={busy}>Ajouter l'URL</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploadPct !== null}>
            <Icon name="upload" size={16} /> {uploadPct !== null ? `Upload ${uploadPct}%` : 'Importer un fichier'}
          </button>
          <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
        </div>
        {uploadPct !== null && <div className="bar" style={{ marginTop: 10 }}><div style={{ width: `${uploadPct}%` }} /></div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.length === 0 && <div className="card muted">Aucune source. Importe une vidéo pour commencer.</div>}
        {sources.map((s) => (
          <div key={s.id} className="card">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || s.url}</div>
                <div className="muted small">#{s.id} · {s.author || 'auteur inconnu'} · {s.status}{s.error ? ` · ${s.error}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Clips
                  <input type="number" min={1} max={10} value={counts[s.id] ?? 3} disabled={s.status === 'running'} onChange={(e) => setCounts((m) => ({ ...m, [s.id]: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))) }))} style={{ width: 56 }} />
                </label>
                <button className="btn primary" onClick={() => run(s.id)} disabled={s.status === 'running'}>
                  {s.status === 'running' ? 'En cours…' : 'Lancer'}
                </button>
                <button className="btn" onClick={goClips}>Voir clips</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Clips({ clips, onRefresh, toast, ttProfile }: { clips: ClipDTO[]; onRefresh: () => Promise<void>; toast: (m: string) => void; ttProfile: { nickname: string | null } | null }): JSX.Element {
  const [modal, setModal] = useState<ClipDTO | null>(null)
  async function review(id: number, status: ClipDTO['reviewStatus']): Promise<void> {
    await api.reviewClip(id, status)
    await onRefresh()
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clips ({clips.length})</h1>
          <p>Valide, prévisualise et publie tes clips verticaux.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
        {clips.length === 0 && <div className="card muted">Aucun clip généré pour l'instant.</div>}
        {clips.map((c) => (
          <div key={c.id} className="card" style={{ padding: 12 }}>
            {c.filePath ? (
              <video src={clipUrl(c.filePath)} controls style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '9 / 16' }} />
            ) : (
              <div className="muted small">Pas d'aperçu</div>
            )}
            <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14 }}>{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
            {c.hashtags && <div className="small" style={{ color: 'var(--accent)', marginTop: 2 }}>{c.hashtags}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small muted">{c.score != null ? `score ${(c.score * 100).toFixed(0)}%` : ''}</span>
              <span className="chip" style={{ background: c.publishStatus === 'published' ? '#dcfce7' : 'var(--accent-soft)', color: c.publishStatus === 'published' ? 'var(--good)' : 'var(--accent-strong)' }}>{c.publishStatus}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {c.reviewStatus !== 'approved' && <button className="btn small" onClick={() => review(c.id, 'approved')}>Approuver</button>}
              {c.reviewStatus !== 'rejected' && <button className="btn small" onClick={() => review(c.id, 'rejected')}>Rejeter</button>}
              <button className="btn primary small" onClick={() => setModal(c)}>{c.publishStatus === 'published' ? 'Republier' : 'Publier'}</button>
            </div>
          </div>
        ))}
      </div>
      {modal && <PublishModal clip={modal} ttNickname={ttProfile?.nickname ?? null} onClose={() => setModal(null)} onDone={onRefresh} toast={toast} />}
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
    api.getFlag('publish_mode').then((r) => setMode(r.value || 'export')).catch(() => undefined)
    api.tiktokCheck().then((info) => {
      setOpts(info.privacyOptions)
      setPrivacy(info.privacyOptions[0] ?? 'SELF_ONLY')
      setDisabledFlags({ comment: info.commentDisabled, duet: info.duetDisabled, stitch: info.stitchDisabled })
      setAllow({ comment: !info.commentDisabled, duet: !info.duetDisabled, stitch: !info.stitchDisabled })
    }).catch(() => setOpts(['SELF_ONLY']))
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
            Compte : {ttNickname ? `@${ttNickname}` : '—'} · mode {mode === 'tiktok' ? 'Direct' : mode === 'tiktok_draft' ? 'Brouillon' : 'Export'}
          </div>
          <label className="muted small">Légende</label>
          <textarea className="input-full" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} style={{ marginTop: 4 }} />
          {mode === 'tiktok' && (
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
                <label className="small" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /> Divulguer un contenu commercial
                </label>
                {commercial && (
                  <div style={{ marginLeft: 18 }}>
                    <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={brand.organic} onChange={(e) => setBrand((b) => ({ ...b, organic: e.target.checked }))} /> Votre marque</label>
                    <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={brand.content} onChange={(e) => setBrand((b) => ({ ...b, content: e.target.checked }))} /> Contenu de marque (tiers)</label>
                  </div>
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
  const [tt, setTt] = useState<{ connected: boolean; hasConfig: boolean; hasSecret: boolean } | null>(null)
  const [ttCode, setTtCode] = useState('')
  const [secret, setSecret] = useState('')

  const loadFlag = useCallback(async (k: string) => {
    const r = await api.getFlag(k)
    setFlags((f) => ({ ...f, [k]: r.value ?? '' }))
  }, [])
  useEffect(() => {
    ;['publish_mode', 'highlights_model', 'transcribe_enabled', 'transcribe_backend', 'reframe_focus', 'tiktok_privacy', 'tiktok_client_key', 'tiktok_redirect', 'schedule_enabled', 'schedule_cron'].forEach((k) => loadFlag(k).catch(() => undefined))
    api.apiKeyStatus().then(setKeyStatus).catch(() => undefined)
    api.groqStatus().then((r) => setGroqHas(r.has)).catch(() => undefined)
    api.tiktokStatus().then(setTt).catch(() => undefined)
  }, [loadFlag])

  const setFlag = async (k: string, v: string): Promise<void> => {
    setFlags((f) => ({ ...f, [k]: v }))
    await api.setFlag(k, v)
    if (k === 'schedule_enabled' || k === 'schedule_cron') await api.reloadScheduler()
  }

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
          </select>
        </Field>
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
