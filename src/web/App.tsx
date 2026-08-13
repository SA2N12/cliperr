import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  api,
  subscribe,
  clipUrl,
  type SourceDTO,
  type ClipDTO,
  type ProgressEvent,
  type ViralIdea,
  type SavedIdea,
  type SubStyleDTO,
  type StyleLibDTO,
  type ImgStyleDTO,
  type ImgLibDTO,
  type PresetDTO,
  type PresetLibDTO,
  type ProductDTO,
  type MontageVideoDTO,
  type MontageDTO
} from './api'

type Page = 'dashboard' | 'autopilot' | 'categories' | 'niches' | 'produits' | 'montage' | 'analyse' | 'clipping' | 'genai' | 'ideas' | 'history' | 'clips' | 'providers' | 'settings'

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sources: 'M12 3l9 4-9 4-9-4 9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  clips: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M16 9h4M4 15h4M16 15h4',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
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
  sparkles: 'M9 8 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6 z M17.5 3 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1 z',
  check: 'M20 6L9 17l-5-5',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18',
  plug: 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7h.01M7.5 16h.01',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 9.12L12 13',
  twitch: 'M4 4h16v10l-4 4h-3l-3 3v-3H4zM10 8v4M15 8v4',
  // Categories : etiquette.
  heart: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V5a2 2 0 012-2h7a2 2 0 011.4.6l7.4 7.4a2 2 0 010 2.8zM7.5 7.5h.01',
  // Bascule de thème : on affiche l'icône de la destination (lune en clair =
  // « passer en sombre »), convention la plus répandue.
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'
}

// Valeur spéciale du sélecteur en haut à droite : « Tous les comptes » (vue globale).
const ALL_SCOPE = '__all__'

// ── Repère couleur des catégories ──────────────────────────────────────────
// Une même teinte désigne une catégorie PARTOUT : dans les blocs du planning et
// sur la page Catégories. C'est ce qui permet de lire un planning d'un coup
// d'œil sans déchiffrer chaque libellé tronqué.
// Les types internes du planning s'y rattachent : une série ou un sujet imposé
// restent des vidéos de niche. Les carrousels gardent leur teinte propre — ils
// vivent sous « Niches » mais produisent des photos, et c'est justement ce qu'on
// veut distinguer d'un regard. Un clip en stock est un clip déjà découpé.
const CAT_OF: Record<string, string> = {
  niche: 'niche', serie: 'niche', custom: 'niche',
  carousel: 'carousel', slideshow: 'carousel',
  // Le stock a sa PROPRE teinte : republier un clip déjà produit ne coûte rien
  // et ne mobilise aucune génération — c'est une nature de créneau différente
  // d'un découpage à faire, même si le résultat est un clip dans les deux cas.
  clip: 'clip', stock: 'stock'
}
const catKey = (type?: string | null): string => CAT_OF[String(type ?? '')] ?? 'niche'
const catColor = (type?: string | null): string => `var(--cat-${catKey(type)})`
/** Légende du planning : l'ordre suit celui de la page Catégories. */
const CAT_LEGENDE: { key: string; label: string }[] = [
  // Carrousel partage désormais la teinte de niche : deux entrées de légende de
  // la même couleur laisseraient croire à une distinction qui n'existe plus.
  { key: 'niche', label: 'Niche' },
  { key: 'clip', label: 'Clip' },
  { key: 'stock', label: 'En stock' }
]
/**
 * Icône Google (Material Symbols). La police est chargée en sous-ensemble dans
 * index.html : n'utiliser QUE des noms listés dans son paramètre `icon_names`.
 */
function MIcon({ name, size = 15, spin, style }: { name: string; size?: number; spin?: boolean; style?: CSSProperties }): JSX.Element {
  return <span className={spin ? 'msym spin' : 'msym'} style={{ fontSize: size, ...style }} aria-hidden>{name}</span>
}

function Icon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

function Logo({ size = 26 }: { size?: number }): JSX.Element {
  // Identifiant de dégradé UNIQUE par instance : le logo est rendu à deux
  // endroits, et deux `<linearGradient id="...">` identiques dans le même
  // document feraient pointer les deux marques sur la première définition.
  const grad = `cliperr-grad-${useId()}`
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cliperr" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={grad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#3ECF8E" />
        </linearGradient>
      </defs>
      <g transform="translate(100,100) rotate(-22)" fill="none" stroke={`url(#${grad})`} strokeWidth="22" strokeLinecap="round">
        <path d="M 10.4,-59.1 A 60,60 0 1 0 10.4,59.1" />
        <path d="M 39.4,-45.3 A 60,60 0 0 1 59.8,-5.2" />
        <path d="M 53.9,26.3 A 60,60 0 0 1 39.4,45.3" />
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
    <div className="genw" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60, width: open ? 330 : 'auto', maxWidth: 'calc(100vw - 32px)' }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--accent)', color: '#fff', border: 0, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
          <span className="dot" style={{ background: '#fff' }} />
          {items.length} génération{items.length > 1 ? 's' : ''} en cours
          <span style={{ marginLeft: 'auto', fontSize: 12 }}>{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 340, overflowY: 'auto' }}>
            {items.map((it) => (
              <div key={it.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="small" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
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
    <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5, fontWeight: 600, flexShrink: 0 }}>
      {(name?.[0] ?? 'C').toUpperCase()}
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
      {/* Style Supabase : sans bordure ni fond, fond au survol, double chevron. */}
      <button className="tb-picker" onClick={() => setOpen((o) => !o)}>
        {/* Pas de pastille ici : le libellé suffit à dire où l'on est, et la barre
            du haut reste sobre. Les vignettes restent dans la liste déroulante,
            où elles servent à repérer un compte d'un coup d'œil. */}
        {isAll ? 'Tous les comptes' : cur ? label(cur) : '—'}
        <svg className="tb-chev" width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5.5L5 2.5L8 5.5" />
          <path d="M2 8.5L5 11.5L8 8.5" />
        </svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
          {/* Aligné à GAUCHE : le sélecteur vit dans la barre du haut, côté gauche. */}
          <div className="card tb-menu" style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 81, minWidth: 240, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              className="nav-item"
              onClick={() => { onChange(ALL_SCOPE); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: isAll ? 'var(--accent-soft-2)' : undefined }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                {/* Pas de graisse en dur : c'est `.tb-menu .nav-item` qui décide,
                    sinon l'inline gagnerait et l'entrée resterait plus grasse
                    que les comptes juste en dessous. */}
                <span>Tous les comptes</span>
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
/** Alerte de quota. Le sélecteur de profil, lui, vit désormais dans la barre du haut. */
function TopBar({ state }: { state: PublishStateT | null }): JSX.Element | null {
  if (!state || state.mode !== 'uploadpost' || !state.quotaReached) return null
  const quotaProf = state.profiles.find((p) => p.username === state.quotaProfile)
  return (
    <div className="card" style={{ marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 10 }}>
      <MIcon name="warning" size={18} />
      <div className="small">
        <b>Quota journalier atteint pour {quotaProf?.handle ? `@${quotaProf.handle}` : state.quotaProfile}.</b> TikTok limite le nombre de publications par jour et par compte. La publication reprendra automatiquement dès que possible — ou choisis un autre profil en haut de la page.
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
<Logo size={44} /> Cliperr
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

// ── Palette de commandes (Ctrl K) ──────────────────────────────────────────
// Tout ce que l'interface sait faire, atteignable au clavier sans chercher le
// bouton : les pages, les actions globales, les comptes.
type Cmd = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void }

/** Minuscules sans accents : taper « generation » doit trouver « Génération IA ». */
const sansAccent = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function Palette({ cmds, onClose }: { cmds: Cmd[]; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => {
    const n = sansAccent(q.trim())
    if (!n) return cmds
    // Chaque mot doit apparaitre, dans n'importe quel ordre et n'importe où :
    // « auto pilote » trouve « Pilote auto » aussi bien que « Pilote auto ».
    const mots = n.split(/\s+/)
    return cmds.filter((c) => {
      const foin = sansAccent(`${c.group} ${c.label} ${c.hint ?? ''}`)
      return mots.every((m) => foin.includes(m))
    })
  }, [cmds, q])

  // La selection repart en tete a chaque frappe : sans ca elle pointerait hors
  // de la liste des que le filtre se resserre.
  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { inputRef.current?.focus() }, [])
  // Garde l'entree choisie visible quand on descend au clavier.
  useEffect(() => { listRef.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const lancer = (c: Cmd | undefined): void => {
    if (!c) return
    // On ferme AVANT d'agir : plusieurs commandes changent de page, la palette
    // ne doit pas rester au-dessus du resultat.
    onClose()
    c.run()
  }

  const onKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (hits.length ? (i + 1) % hits.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); lancer(hits[sel]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  // Groupes dans l'ordre d'apparition — on n'impose pas d'ordre aux commandes,
  // c'est celui du tableau qui fait foi. `i` reste l'index dans `hits`, seul
  // repere valable pour la selection au clavier.
  const groupes: { nom: string; items: { c: Cmd; i: number }[] }[] = []
  hits.forEach((c, i) => {
    let g = groupes.find((x) => x.nom === c.group)
    if (!g) { g = { nom: c.group, items: [] }; groupes.push(g) }
    g.items.push({ c, i })
  })

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="card pal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="pal-head">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            className="pal-input"
            placeholder="Une page, une action, un compte…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="kbd">Échap</span>
        </div>
        <div className="pal-list" ref={listRef}>
          {hits.length === 0 && <div className="pal-vide">Rien ne correspond à « {q.trim()} »</div>}
          {groupes.map((g) => (
            <div key={g.nom}>
              <div className="pal-group">{g.nom}</div>
              {g.items.map(({ c, i }) => (
                <button
                  key={c.id}
                  className={`pal-item${i === sel ? ' on' : ''}`}
                  // Le survol deplace la selection : la souris et le clavier
                  // designent la meme entree, jamais deux differentes.
                  onMouseMove={() => setSel(i)}
                  onClick={() => lancer(c)}
                >
                  <Icon name={c.icon} size={15} />
                  <span className="pal-label">{c.label}</span>
                  {c.hint && <span className="pal-hint">{c.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="pal-foot">
          <span><span className="kbd">↑</span><span className="kbd">↓</span> naviguer</span>
          <span><span className="kbd">Entrée</span> lancer</span>
          <span>{hits.length} commande{hits.length > 1 ? 's' : ''}</span>
        </div>
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
  // Console « Activité en direct » : ouverte depuis la topbar (à droite de la recherche).
  const [consoleOpen, setConsoleOpen] = useState(false)
  // Palette de commandes (Ctrl K). `autoOn` sert uniquement à libeller la
  // commande marche/pause du pilote : on ne le lit qu'à l'ouverture, cet écran
  // n'a pas besoin de suivre l'état du pilote le reste du temps.
  const [palOpen, setPalOpen] = useState(false)
  const [autoOn, setAutoOn] = useState<boolean | null>(null)
  // Mode d'affichage de la sidebar (contrôle en bas de barre, façon Supabase).
  // Préférence d'appareil → localStorage, pas la BDD.
  const [sideMode, setSideMode] = useState<'expanded' | 'collapsed' | 'hover'>(() => {
    const v = localStorage.getItem('sidebar_mode')
    return v === 'expanded' || v === 'collapsed' ? v : 'hover'
  })
  const [sideMenuOpen, setSideMenuOpen] = useState(false)
  const changeSideMode = (m: 'expanded' | 'collapsed' | 'hover'): void => {
    setSideMode(m)
    localStorage.setItem('sidebar_mode', m)
    setSideMenuOpen(false)
  }
  // Thème clair/sombre : préférence d'APPAREIL (localStorage), comme le mode de
  // la sidebar — pas la BDD, un même compte peut être ouvert sur deux écrans
  // réglés différemment. Sans choix enregistré, on suit le réglage du système.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const v = localStorage.getItem('theme')
    if (v === 'light' || v === 'dark') return v
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  // L'attribut vit sur <html> et non sur un conteneur React : les volets et les
  // menus sont rendus en `position: fixed` hors de l'arbre de l'app, ils doivent
  // eux aussi hériter du thème.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggleTheme = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
  }

  // Ctrl K / ⌘K ouvre et referme la palette. En capture, pour passer devant les
  // champs de saisie : le raccourci doit marcher même le curseur dans un input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // État du pilote lu à CHAQUE ouverture : il a pu changer depuis la dernière
  // fois, et une commande « Démarrer » sur un pilote déjà en marche serait un
  // piège. Tant qu'on ne l'a pas, la commande marche/pause n'est pas proposée.
  useEffect(() => {
    if (!palOpen) return
    let vivant = true
    api.autopilotState().then((s) => { if (vivant) setAutoOn(s.enabled) }).catch(() => undefined)
    return () => { vivant = false }
  }, [palOpen])
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
        // Fin de génération OU nouvelle étape de recadrage (un clip vient d'être
        // créé) → on recharge les clips : ils apparaissent au fil de la génération
        // dans la barre latérale du clipage.
        if (e.status === 'done' || e.status === 'error' || e.stage === 'reframe') refresh().catch(() => undefined)
      },
      onIdeaVideo: (e) => {
        setIdeaVideo((m) => ({ ...m, [e.ideaId]: { status: e.status, message: e.message } }))
        if (e.status === 'done' || e.status === 'error') refresh().catch(() => undefined)
        // Une génération qui échoue restait muette : seul le widget en bas à
        // droite changeait de couleur. On le dit explicitement.
        if (e.status === 'error') showToast(`Génération échouée — ${e.message}`.slice(0, 200))
        // Neutre : le pilote auto émet les mêmes événements et publie, lui, dans la foulée.
        if (e.status === 'done') showToast(e.message || 'Vidéo prête')
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

  const navGroups: { id: Page; label: string; icon: string }[][] = [
    [
      { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
      // Visible quel que soit le compte choisi : la vue filtre alors le planning
      // sur ce compte (l'interrupteur, lui, reste global).
      { id: 'autopilot', label: 'Pilote auto', icon: 'bolt' },
      { id: 'categories', label: 'Catégories', icon: 'tag' }
    ],
    [
      { id: 'clipping', label: 'Clipage', icon: 'scissors' },
      { id: 'genai', label: 'Génération IA', icon: 'sparkles' },
      // Les niches alimentent la génération : leur place est dans ce groupe,
      // pas avec les réglages du pilote.
      { id: 'niches', label: 'Niches', icon: 'bulb' },
      // Le catalogue alimente le contenu promotionnel, au meme titre que les
      // niches alimentent le tout-venant.
      { id: 'produits', label: 'Produits', icon: 'sources' },
      // Une vidéo est presque toujours ratée par UN plan : le montage le rejoue
      // seul, au lieu de tout régénérer.
      { id: 'montage', label: 'Montage', icon: 'play' },
      { id: 'clips', label: 'Clips', icon: 'clips' }
    ],
    [
      { id: 'history', label: 'Historique', icon: 'list' },
      { id: 'providers', label: 'Fournisseurs', icon: 'plug' },
      { id: 'settings', label: 'Réglages', icon: 'settings' }
    ]
  ]

  // Commandes de la palette. L'ordre du tableau est celui de l'affichage : les
  // pages d'abord, ce que l'on vient chercher neuf fois sur dix.
  const cmds: Cmd[] = [
    ...navGroups.flat().map((n) => ({
      id: `go:${n.id}`,
      group: 'Aller à',
      label: n.label,
      icon: n.icon,
      run: () => setPage(n.id)
    })),
    {
      id: 'act:theme',
      group: 'Actions',
      label: theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre',
      icon: theme === 'dark' ? 'sun' : 'moon',
      run: toggleTheme
    },
    {
      id: 'act:console',
      group: 'Actions',
      label: consoleOpen ? 'Fermer la console' : 'Ouvrir la console d’activité',
      hint: 'journal en direct',
      icon: 'terminal',
      run: () => setConsoleOpen((v) => !v)
    },
    {
      id: 'act:run',
      group: 'Actions',
      label: 'Lancer un cycle du pilote maintenant',
      hint: 'génère et publie 1 vidéo',
      icon: 'bolt',
      run: () => {
        api.runAutopilotNow()
          .then(() => showToast('Cycle lancé — suis la progression en bas à droite'))
          .catch((e: Error) => showToast('Erreur : ' + e.message))
      }
    },
    // Proposée seulement une fois l'état connu : sans lui, le libellé mentirait
    // une fois sur deux et la commande ferait l'inverse de ce qu'elle annonce.
    ...(autoOn === null ? [] : [{
      id: 'act:auto',
      group: 'Actions',
      label: autoOn ? 'Mettre le pilote en pause' : 'Démarrer le pilote',
      hint: autoOn ? 'en marche' : 'en pause',
      icon: autoOn ? 'pause' : 'play',
      run: () => {
        const next = !autoOn
        api.saveAutopilot({ enabled: next })
          .then(() => { setAutoOn(next); showToast(next ? 'Pilote démarré' : 'Pilote en pause') })
          .catch((e: Error) => showToast('Erreur : ' + e.message))
      }
    }]),
    {
      id: 'act:refresh',
      group: 'Actions',
      label: 'Rafraîchir les clips et les sources',
      icon: 'refresh',
      run: () => { void refresh().catch(() => showToast('Rafraîchissement impossible')) }
    },
    ...(['expanded', 'collapsed', 'hover'] as const).map((m) => ({
      id: `act:side:${m}`,
      group: 'Actions',
      label: `Menu latéral : ${m === 'expanded' ? 'toujours déployé' : m === 'collapsed' ? 'toujours replié' : 'déployé au survol'}`,
      icon: 'list',
      run: () => changeSideMode(m)
    })),
    { id: 'act:logout', group: 'Actions', label: 'Se déconnecter', icon: 'logout', run: () => { void api.logout().then(onLogout) } },
    {
      id: 'sc:all',
      group: 'Comptes',
      label: 'Tous les comptes',
      hint: isAll ? 'vue actuelle' : undefined,
      icon: 'globe',
      run: () => { void changeScope(ALL_SCOPE) }
    },
    ...(pub?.profiles ?? []).map((p) => ({
      id: `sc:${p.username}`,
      group: 'Comptes',
      label: p.handle ? `@${p.handle}` : p.username,
      hint: p.username === scope ? 'vue actuelle' : undefined,
      icon: 'globe',
      run: () => { void changeScope(p.username) }
    }))
  ]

  return (
    <div className="app">
      {palOpen && <Palette cmds={cmds} onClose={() => setPalOpen(false)} />}
      {/* Barre du haut, pleine largeur : logo · compte TikTok actif …
          recherche · compte du dashboard. */}
      <header className="topbar">
        {/* Logo centré dans une zone de la largeur du rail → aligné avec les icônes de la sidebar. */}
        <div className="tb-logo"><Logo size={30} /></div>
        {/* Sélecteur de comptes collé au bord droit de la sidebar (pas de « / »). */}
        {(pub?.profiles.length ?? 0) > 0 && (
          <ProfilePicker profiles={pub?.profiles ?? []} active={scope} onChange={changeScope} />
        )}
        <div style={{ flex: 1 }} />
        <button className="tb-search" title="Palette de commandes — pages, actions, comptes" onClick={() => setPalOpen(true)}>
          <Icon name="search" size={14} /> Rechercher <span className="kbd">Ctrl K</span>
        </button>
        {/* Console d'activité (style bouton « console » de Supabase) : ouvre un
            volet latéral venant de la droite (rendu hors du header). */}
        <button
          className={`tb-console${consoleOpen ? ' open' : ''}`}
          title="Activité — historique complet"
          onClick={() => setConsoleOpen((v) => !v)}
        >
          <Icon name="terminal" size={14} /> Console
        </button>
        {/* Bascule clair/sombre. L'icône montre la destination, pas l'état
            courant : en thème clair on voit une lune (« passer en sombre »). */}
        <button
          className="tb-theme"
          title={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
          aria-pressed={theme === 'dark'}
          onClick={toggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
        {/* Compte du dashboard : tuile dégradé bleu → vert pastel, sans bordure. */}
        <button
          className="tb-account"
          title={`${ttProfile?.nickname ? '@' + ttProfile.nickname : 'Compte'} — se déconnecter`}
          onClick={() => api.logout().then(onLogout)}
          style={{ background: 'linear-gradient(135deg, #bae6fd 0%, #99f6e4 55%, #bbf7d0 100%)' }}
        />
      </header>

      {consoleOpen && <ConsolePanel live={log} onClose={() => setConsoleOpen(false)} />}

      {/* Barre en colonne d'icônes ; trois modes (contrôle en bas, façon Supabase) :
          déployée en permanence, repliée, ou déploiement au survol. */}
      <aside className={`sidebar ${sideMode === 'expanded' ? 'expanded' : sideMode === 'collapsed' ? 'collapsed' : 'hoverable'}`}>
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="nav-sep-line" />}
            {group.map((n) => (
              <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} title={n.label} onClick={() => setPage(n.id)}>
                <Icon name={n.icon} size={16} /> <span className="lbl">{n.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="spacer" />
        <div>
          <button
            className={`nav-item${sideMenuOpen ? ' active' : ''}`}
            title="Affichage de la barre latérale"
            onClick={() => setSideMenuOpen((v) => !v)}
          >
            <MIcon name={sideMode === 'collapsed' ? 'left_panel_open' : 'left_panel_close'} size={16} />
            <span className="lbl">Barre latérale</span>
          </button>
        </div>
      </aside>
      {sideMenuOpen && (
        <>
          <div className="side-ctl-backdrop" onClick={() => setSideMenuOpen(false)} />
          <div className="side-ctl-menu">
            <div className="sc-title">Barre latérale</div>
            {(
              [
                ['expanded', 'Déployée'],
                ['collapsed', 'Repliée'],
                ['hover', 'Déployée au survol']
              ] as const
            ).map(([m, lbl]) => (
              <button key={m} className={`sc-item${sideMode === m ? ' on' : ''}`} onClick={() => changeSideMode(m)}>
                <span className="dot" /> {lbl}
              </button>
            ))}
          </div>
        </>
      )}

      <main className="main">
        <TopBar state={pub} />
        {page === 'dashboard' && <Dashboard scope={scope} />}
        {page === 'autopilot' && <Autopilot toast={showToast} ideaVideo={ideaVideo} scope={scope} />}
        {page === 'categories' && <CategoriesPage toast={showToast} profiles={pub?.profiles ?? []} />}
        {page === 'niches' && <NichesPage toast={showToast} />}
        {page === 'produits' && <ProduitsPage toast={showToast} />}
        {page === 'montage' && <MontagePage toast={showToast} />}
        {page === 'clipping' && <Clipage sources={sources} clips={clips} progress={progress} onRefresh={refresh} toast={showToast} />}
        {page === 'genai' && <GenAI toast={showToast} />}
        {page === 'history' && <History sources={sources} clips={clips} progress={progress} onRefresh={refresh} toast={showToast} goClips={() => setPage('clips')} />}
        {page === 'clips' && <Clips clips={clips} sources={sources} onRefresh={refresh} toast={showToast} scope={scope} />}
        {page === 'providers' && <Providers go={setPage} />}
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

/** Anime un nombre de sa valeur précédente vers la nouvelle (easing sortie cubique). */
function useCountUp(value: number, duration = 850): number {
  const [n, setN] = useState(0)
  const shown = useRef(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shown.current = value
      setN(value)
      return
    }
    const from = shown.current
    const start = performance.now()
    let raf = 0
    const tick = (t: number): void => {
      const p = Math.min(1, (t - start) / duration)
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)))
      shown.current = v
      setN(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return n
}

/** Nombre qui « monte » à l'affichage. Composant à part : garde l'ordre des hooks stable. */
function CountUp({ value }: { value: number }): JSX.Element {
  return <>{fmtNum(useCountUp(value))}</>
}

/**
 * Courbe lissée (Catmull-Rom → béziers). Les points de contrôle sont bornés à
 * la zone de tracé : une pointe isolée ne peut pas faire sortir la courbe.
 */
function smoothLine(pts: { x: number; y: number }[], top: number, bottom: number): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  const clamp = (v: number): number => Math.max(top, Math.min(bottom, v))
  const t = 0.18
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = clamp(p1.y + (p2.y - p0.y) * t)
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = clamp(p2.y - (p3.y - p1.y) * t)
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/**
 * Graphique d'aires : grille, courbe lissée, point final, et au survol un
 * repère vertical + infobulle (valeur du jour).
 *
 * Le SVG est étiré (`preserveAspectRatio="none"`) pour remplir la carte → tout
 * ce qui ne doit PAS être déformé (textes, points, infobulle) est rendu en HTML
 * par-dessus, positionné en pourcentage.
 */
function AreaChart({ data }: { data: Bucket[] }): JSX.Element {
  const W = 600
  const H = 200
  const PAD_T = 12
  const PAD_B = 4
  const n = data.length
  const max = Math.max(1, ...data.map((d) => d.count))
  const [hover, setHover] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const x = (i: number): number => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number): number => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)
  const pts = data.map((d, i) => ({ x: x(i), y: y(d.count) }))
  const line = smoothLine(pts, PAD_T, H - PAD_B)
  const area = n ? `${line} L${W},${H} L0,${H} Z` : ''

  const onMove = (e: MouseEvent<HTMLDivElement>): void => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r || n < 2) return
    const rel = (e.clientX - r.left) / r.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))))
  }

  const hv = hover != null ? data[hover] : null
  const hoverPct = hover != null && n > 1 ? (hover / (n - 1)) * 100 : 0
  const last = data[n - 1]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div ref={wrapRef} className="chart-wrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg className="chart-draw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={PAD_T + f * (H - PAD_T - PAD_B)}
              y2={PAD_T + f * (H - PAD_T - PAD_B)}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill="url(#ag)" />
          <path
            d={line}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--muted-2)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span className="chart-ymax">{fmtNum(max)}</span>
        {last && <span className="chart-dot" style={{ left: '100%', top: `${(y(last.count) / H) * 100}%` }} />}
        {hv && (
          <>
            <span className="chart-dot hover" style={{ left: `${hoverPct}%`, top: `${(y(hv.count) / H) * 100}%` }} />
            <div className="chart-tip" style={{ left: `${Math.min(90, Math.max(10, hoverPct))}%` }}>
              <b>{fmtNum(hv.count)}</b> vues <span className="dim">· {hv.label}</span>
              {/* Dernier point = jour en cours : TikTok consolide sa série
                  journalière avec plusieurs heures de retard, le chiffre est
                  donc toujours en dessous des compteurs live de l'app. */}
              {hover === n - 1 && <span className="dim"> · provisoire</span>}
            </div>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="small muted">{data[0]?.label}</span>
        <span className="small muted">{data[Math.floor(n / 2)]?.label}</span>
        <span className="small muted">{data[n - 1]?.label}</span>
      </div>
    </div>
  )
}

/**
 * Console d'activité : volet latéral qui arrive de la DROITE. Affiche tout
 * l'historique persisté en base (pagination « plus ancien »), plus les lignes
 * reçues en direct depuis l'ouverture du volet.
 */
function ConsolePanel({ live, onClose }: { live: string[]; onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<{ id: number; message: string; createdAt: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [end, setEnd] = useState(false)
  // `live` est trié du plus récent au plus ancien : les nouveautés arrivent en tête.
  const baseLen = useRef(live.length)
  const fresh = live.slice(0, Math.max(0, live.length - baseLen.current))

  useEffect(() => {
    api
      .activity()
      .then((r) => {
        setRows(r)
        if (r.length < 200) setEnd(true)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  const loadOlder = async (): Promise<void> => {
    const last = rows[rows.length - 1]
    if (!last) return
    setMore(true)
    try {
      const r = await api.activity(last.id)
      setRows((cur) => [...cur, ...r])
      if (r.length < 200) setEnd(true)
    } catch {
      /* ignoré */
    } finally {
      setMore(false)
    }
  }

  const fmtTime = (ts: number): string =>
    new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="console-backdrop" onClick={onClose} />
      <aside className="console-panel">
        <div className="cp-head">
          <div className="row">
            <strong>Activité</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="chip">SSE</span>
              <button className="btn icon-btn" onClick={onClose} title="Fermer" style={{ width: 28, height: 28, fontSize: 14 }}>✕</button>
            </div>
          </div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Historique complet de Cliperr</p>
        </div>
        <div className="cp-body">
          {fresh.map((l, i) => (
            <div key={`live-${i}`} className="cp-line live">{l}</div>
          ))}
          {loading && <div className="muted small">Chargement de l'historique…</div>}
          {!loading && rows.length === 0 && fresh.length === 0 && (
            <div className="muted small">Aucune activité enregistrée pour l'instant.</div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="cp-line">
              <span className="cp-time">{fmtTime(r.createdAt)}</span>
              {r.message}
            </div>
          ))}
        </div>
        <div className="cp-foot">
          {end ? (
            <span className="muted small">Début de l'historique</span>
          ) : (
            <button className="btn" disabled={more || loading} onClick={() => void loadOlder()}>
              {more ? 'Chargement…' : 'Charger plus ancien'}
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

function Dashboard({ scope }: { scope: string }): JSX.Element {
  const [data, setData] = useState<AnalyticsProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<AnalyticsProfile | null>(null)
  const [posts, setPosts] = useState<PostStat[] | null>(null)
  const [pLoading, setPLoading] = useState(false)
  // Fenêtre du graphique, en jours (ne touche pas aux totaux 30 j du haut).
  const [range, setRange] = useState(30)

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
    // TikTok peut ne pas renvoyer les stats PAR VIDÉO pour un compte (bug de
    // connexion côté upload-post) alors que les totaux du compte sont corrects :
    // tout à zéro sur ≥3 vidéos d'un compte qui a des vues = données absentes,
    // pas des vidéos mortes — on l'affiche clairement pour éviter le contresens.
    const statsUnavailable = list.length >= 3 && open.views > 0 && list.every((v) => !v.views && !v.likes && !v.comments && !v.shares)
    return (
      <>
        <div className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn icon-btn" onClick={() => setOpen(null)} title="Retour">←</button>
            <Avatar url={open.avatarUrl} name={open.profile} size={36} />
            <div>
              <h1 style={{ fontSize: 22 }}>{open.handle ? '@' + open.handle : open.profile}</h1>
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
            {statsUnavailable && (
              <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fef3c7', color: '#b45309' }} className="small">
                <b>⚠ Stats par vidéo indisponibles pour ce compte</b> — TikTok renvoie 0 partout alors que le compte totalise <b>{fmtNum(open.views)} vues</b> : les compteurs ci-dessous ne reflètent PAS la réalité. Pour réparer : reconnecte TikTok pour ce profil sur upload-post.com (Manage profiles → Reconnect). Les totaux du compte, eux, restent fiables.
              </div>
            )}
            {list.map((v) => (
              <div key={v.clipId} className="card">
                <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                  {v.filePath && <video src={clipUrl(v.filePath)} muted preload="metadata" style={{ width: 46, borderRadius: 8, background: '#000', aspectRatio: '9 / 16', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title || `Vidéo #${v.clipId}`}</div>
                    {v.postUrl && <a href={v.postUrl} target="_blank" rel="noreferrer" className="small" style={{ color: 'var(--accent)' }}>Voir sur TikTok ↗</a>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                    {[['Vues', v.views], ['Likes', v.likes], ['Comm.', v.comments], ['Part.', v.shares]].map(([l, n]) => (
                      <div key={l as string} style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600 }}>{fmtNum(n as number)}</div>
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
  // Période affichée par le graphique (les 4 cartes du haut restent sur 30 j).
  const shown = range >= buckets.length ? buckets : buckets.slice(-range)
  const totalPeriod = shown.reduce((a, b) => a + b.count, 0)
  const avgPerDay = shown.length ? Math.round(totalPeriod / shown.length) : 0
  const peak = shown.reduce((m, b) => (b.count > m.count ? b : m), { label: '—', count: 0 })
  const vals = buckets.map((b) => b.count)
  const last7 = vals.slice(-7).reduce((a, b) => a + b, 0)
  const prev7 = vals.slice(-14, -7).reduce((a, b) => a + b, 0)
  const viewsTrend = prev7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prev7) / prev7) * 100)
  const avgViewsPerVideo = totals.videos ? Math.round(totals.views / totals.videos) : 0
  const engGlobal = eng(totals)
  const maxViews = Math.max(1, ...profiles.map((p) => p.views))

  // `dash-fit` : le dashboard occupe exactement la hauteur dispo de `.main`
  // (qui est le conteneur de défilement) → aucune barre de scroll verticale.
  return (
    <div className="dash-fit">
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
        </div>
      </div>

      {loading && !data ? (
        <>
          <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card">
                <div className="skel" style={{ width: 32, height: 32 }} />
                <div className="skel" style={{ width: '45%', height: 11, marginTop: 12 }} />
                <div className="skel" style={{ width: '60%', height: 26, marginTop: 8 }} />
                <div className="skel" style={{ width: '100%', height: 11, marginTop: 16 }} />
                <div className="skel" style={{ width: '85%', height: 11, marginTop: 8 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginTop: 8, flex: 1, minHeight: 0 }}>
            <div className="card"><div className="skel" style={{ width: '100%', height: '100%' }} /></div>
            <div className="card"><div className="skel" style={{ width: '100%', height: '100%' }} /></div>
          </div>
        </>
      ) : profiles.length === 0 ? (
        <div className="card muted">Aucune donnée de performance. Configure la clé upload-post (Réglages) et publie des vidéos.</div>
      ) : (
        <>
          <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 }}>
            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="chart" /></div>
                <TrendBadge value={viewsTrend} />
              </div>
              <div className="label" style={{ marginTop: 8 }}>Vues (30 j)</div>
              <div className="value"><CountUp value={totals.views} /></div>
              <div className="breakdown">
                <div className="line"><span className="k">≈ / vidéo</span><span className="v">{fmtNum(avgViewsPerVideo)}</span></div>
                <div className="line"><span className="k">7 derniers jours</span><span className="v">{fmtNum(last7)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="heart" /></div>
                <span className="pill-badge"><span className="dot" /> {engGlobal}</span>
              </div>
              <div className="label" style={{ marginTop: 8 }}>Likes</div>
              <div className="value"><CountUp value={totals.likes} /></div>
              <div className="breakdown">
                <div className="line"><span className="k">Commentaires</span><span className="v">{fmtNum(totals.comments)}</span></div>
                <div className="line"><span className="k">Partages</span><span className="v">{fmtNum(totals.shares)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="globe" /></div>
              </div>
              <div className="label" style={{ marginTop: 8 }}>Abonnés</div>
              <div className="value"><CountUp value={totals.followers} /></div>
              <div className="breakdown">
                <div className="line"><span className="k">Comptes</span><span className="v">{profiles.length}</span></div>
                <div className="line"><span className="k">Top compte</span><span className="v">{profiles[0]?.handle ? '@' + profiles[0].handle : profiles[0]?.profile ?? '—'}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="stat-head">
                <div className="icon"><Icon name="clips" /></div>
              </div>
              <div className="label" style={{ marginTop: 8 }}>Vidéos publiées</div>
              <div className="value"><CountUp value={totals.videos} /></div>
              <div className="breakdown">
                <div className="line"><span className="k">Engagement</span><span className="v">{engGlobal}</span></div>
                <div className="line"><span className="k">Vues / vidéo</span><span className="v">{fmtNum(avgViewsPerVideo)}</span></div>
              </div>
            </div>
          </div>

          {/* alignItems par défaut (stretch) : les deux cartes finissent à la même hauteur ;
              le graphique s'étire pour remplir la carte de gauche. */}
          <div className="dash-row" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginTop: 12, flex: 1, minHeight: 0 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div className="row">
                <div>
                  <strong>Vues dans le temps</strong>
                </div>
                <div className="seg">
                  {[7, 14, 30].map((d) => (
                    <button key={d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{d} j</button>
                  ))}
                </div>
              </div>
              {/* `key` sur la période : le graphique se redessine à chaque changement. */}
              <div style={{ marginTop: 12, flex: 1, minHeight: 110 }}><AreaChart key={range} data={shown} /></div>
              <div className="metrics-row">
                <div className="metric"><div className="ml">Total période</div><div className="mv">{fmtNum(totalPeriod)}</div></div>
                <div className="metric"><div className="ml">Moyenne / jour</div><div className="mv">{fmtNum(avgPerDay)}</div></div>
                <div className="metric"><div className="ml">Pic</div><div className="mv">{fmtNum(peak.count)} · {peak.label}</div></div>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div className="row" style={{ marginBottom: 2 }}>
                <strong>Répartition des vues</strong>
                <span className="small muted">Eng. <b style={{ color: 'var(--accent-strong)' }}>{engGlobal}</b></span>
              </div>
              <p className="muted small" style={{ margin: '0 0 2px' }}>Par compte · clique pour le détail</p>
              {/* space-between : l'espace libre se place ENTRE les comptes, pas a
                   l'interieur d'eux. Faire grandir les lignes eloignait la jauge des
                   chiffres qu'elle illustre — elle se lisait comme un separateur. */}
              <div className="funnel-list" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {profiles.map((p, i) => (
                  <div
                    key={p.profile}
                    className="funnel-row"
                    onClick={() => openProfile(p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openProfile(p) } }}
                    style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="rank">{i + 1}</span>
                      <Avatar url={p.avatarUrl} name={p.profile} size={22} />
                      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.handle ? '@' + p.handle : p.profile}
                        </div>
                      </div>
                      <Sparkline data={p.timeseries.map((t) => t.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 11, marginTop: 1, alignItems: 'baseline', lineHeight: 1.25 }}>
                      {[['vues', fmtNum(p.views), true], ['likes', fmtNum(p.likes), false], ['com.', fmtNum(p.comments), false], ['part.', fmtNum(p.shares), false]].map(([l, v, big]) => (
                        <span key={l as string} style={{ whiteSpace: 'nowrap' }}>
                          <b style={{ fontWeight: 600, fontSize: big ? 15 : 13, color: big ? 'var(--accent-strong)' : undefined }}>{v}</b>
                          <span className="muted small" style={{ marginLeft: 3 }}>{l}</span>
                          {big === true && totals.views > 0 && (
                            <span className="muted small" style={{ marginLeft: 4 }}>({Math.round((p.views / totals.views) * 100)}%)</span>
                          )}
                        </span>
                      ))}
                      <span className="small go" style={{ marginLeft: 'auto', flexShrink: 0 }}>Voir →</span>
                    </div>
                    {/* Part des vues, en jauge. Elle vaut le POURCENTAGE AFFICHÉ
                        juste au-dessus (part du total), et non la part du leader :
                        une barre qui raconterait autre chose que son chiffre
                        sèmerait le doute sur les deux. */}
                    {totals.views > 0 && (
                      <div className="share-bar">
                        <div style={{ width: `${Math.max(1, (p.views / totals.views) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  )
}

const STAGE_LABELS: Record<string, string> = {
  ingest: 'Téléchargement / import',
  transcribe: 'Transcription',
  highlights: 'Sélection des moments (IA)',
  reframe: 'Génération des clips',
  metadata: 'Génération des légendes'
}

// Onglet « Inspiration » : colle un lien TikTok qui marche → la vidéo est téléchargée
// et transcrite, puis l'IA écrit une idée ORIGINALE qui reprend sa mécanique virale
// (hook, structure, levier émotionnel) — jamais son contenu.
function InspireTab({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [idea, setIdea] = useState<SavedIdea | null>(null)
  const [launched, setLaunched] = useState(false)
  // Liens mis de côté pour être reproduits plus tard (persistés côté serveur
  // via un flag JSON → on les retrouve depuis n'importe quel appareil).
  const [saved, setSaved] = useState<{ url: string; addedAt: number }[]>([])
  // Langue des dialogues de la repro : FR (défaut) ou EN (voix natives des
  // moteurs vidéo, bien meilleures en anglais ; répliques traduites).
  const [lang, setLang] = useState<'fr' | 'en'>('fr')
  useEffect(() => { api.getFlag('repro_lang').then((r) => setLang(r.value === 'en' ? 'en' : 'fr')).catch(() => undefined) }, [])
  const changeLang = (v: 'fr' | 'en'): void => { setLang(v); void api.setFlag('repro_lang', v).catch(() => undefined) }
  // Qualité des scènes parlées une fois le quota Veo GRATUIT épuisé. Jamais
  // mémorisé : un choix qui coûte de l'argent doit être refait sciemment.
  const [quality, setQuality] = useState<'eco' | 'wan' | 'seedance' | 'veo'>('eco')
  // Quota Veo du jour (vidéos parlées restantes, réparties sur fast/full/lite).
  // `deepinfra` : un repli payant sans plafond prend le relais à quota épuisé.
  const [quota, setQuota] = useState<{
    remainingVideos: number
    remainingRequests: number
    deepinfra: boolean
    pricing: { veoPaidScene: number; wanScene: number; seedance2Scene: number; seedanceScene: number; prunaScene: number; image: number; storyboard: number }
  } | null>(null)
  const loadQuota = (): void => { api.veoQuota().then((q) => setQuota({ remainingVideos: q.remainingVideos, remainingRequests: q.remainingRequests, deepinfra: q.deepinfra, pricing: q.pricing })).catch(() => undefined) }
  useEffect(loadQuota, [])

  useEffect(() => {
    api.getFlag('genai_watchlist').then((r) => {
      if (!r.value) return
      try {
        const a = JSON.parse(r.value) as { url?: unknown; addedAt?: unknown }[]
        if (Array.isArray(a)) {
          setSaved(
            a.filter((x) => x && typeof x.url === 'string').map((x) => ({ url: String(x.url), addedAt: typeof x.addedAt === 'number' ? x.addedAt : Date.now() }))
          )
        }
      } catch {
        /* ignore */
      }
    }).catch(() => undefined)
  }, [])

  const persistSaved = (list: { url: string; addedAt: number }[]): void => {
    setSaved(list)
    void api.setFlag('genai_watchlist', JSON.stringify(list)).catch(() => undefined)
  }

  const inspire = async (srcUrl?: string): Promise<void> => {
    const u = (srcUrl ?? url).trim()
    if (!u || busy) return
    setBusy(true)
    setIdea(null)
    setLaunched(false)
    try {
      const r = await api.inspireIdea(u, '', 'reproduce')
      setIdea(r.idea)
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Mettre le lien de côté sans l'analyser : il rejoint la liste « plus tard ».
  const saveLink = (): void => {
    const u = url.trim()
    if (!u) return
    if (saved.some((s) => s.url === u)) {
      toast('Ce lien est déjà enregistré')
      setUrl('')
      return
    }
    persistSaved([{ url: u, addedAt: Date.now() }, ...saved])
    setUrl('')
    toast('Lien enregistré — à reproduire quand tu veux')
  }
  const removeSaved = (u: string): void => persistSaved(saved.filter((s) => s.url !== u))
  // Reproduire un lien enregistré : il quitte la liste et passe en analyse.
  const reproduceSaved = (u: string): void => {
    setUrl(u)
    persistSaved(saved.filter((s) => s.url !== u))
    void inspire(u)
  }
  // Estimation du COÛT de la génération, calculée AVANT de lancer : une scène par
  // réplique de la source, les premières couvertes par le quota Veo gratuit, le
  // reste au tarif du moteur choisi. Les tarifs viennent du serveur (source unique).
  const estimate = (): { scenes: number; free: number; total: number } | null => {
    if (!idea || !quota) return null
    const scenes = Math.max(1, Math.min(60, (idea.script ?? []).length || 8))
    const free = Math.max(0, Math.min(scenes, quota.remainingRequests))
    const paid = scenes - free
    const p = quota.pricing
    const perPaid =
      quality === 'veo' ? p.veoPaidScene
        : quality === 'seedance' ? p.seedance2Scene
          : quality === 'wan' ? p.wanScene
          : lang === 'en' ? p.seedanceScene : p.prunaScene
    return { scenes, free, total: p.storyboard + scenes * p.image + paid * perPaid }
  }
  const est = estimate()
  const money = (n: number): string => (n < 1 ? `${Math.round(n * 100)} ¢` : `${n.toFixed(2)} $`)

  const platformOf = (u: string): { icon: string; label: string } => {
    if (/tiktok\.com/i.test(u)) return { icon: 'music_note', label: 'TikTok' }
    if (/instagram\.com/i.test(u)) return { icon: 'photo_camera', label: 'Instagram' }
    if (/youtube\.com|youtu\.be/i.test(u)) return { icon: 'smart_display', label: 'YouTube' }
    return { icon: 'link', label: 'Lien' }
  }
  const ago = (t: number): string => {
    const d = Math.floor((Date.now() - t) / 86400000)
    return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} j`
  }
  // Vidéo montée (voix off + images + sous-titres) — arrive dans « Clips ».
  const genVideo = async (): Promise<void> => {
    if (!idea) return
    try {
      await api.generateIdeaVideo(idea.id, lang, quality)
      setLaunched(true)
      setTimeout(loadQuota, 8000) // le quota Veo se décompte au fil des scènes
      toast('Vidéo lancée — suis la progression en bas à droite ; elle arrivera dans « Clips »')
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    }
  }

  return (
    <div>
      {/* Barre « coller un lien → reproduire » : champ + bouton attachés. */}
      <div className="card clip-hero clip-anim" style={{ animationDelay: '0.05s' }}>
        <div className={`genai-bar${url.trim() ? ' filled' : ''}`}>
          <Icon name="sources" size={18} />
          <input
            className="genai-input"
            placeholder="Colle un lien TikTok, Instagram (Reel) ou YouTube Short…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void inspire()}
            /* eslint-disable-next-line jsx-a11y/no-autofocus */
            autoFocus
          />
          <button className="btn genai-save" onClick={saveLink} disabled={busy || !url.trim()} title="Mettre ce lien de côté pour le reproduire plus tard">
            <MIcon name="bookmark_add" size={17} /> <span className="genai-save-lbl">Enregistrer</span>
          </button>
          <button className="btn primary genai-go" onClick={() => void inspire()} disabled={busy || !url.trim()}>
            {busy ? <><MIcon name="progress_activity" size={16} spin /> Analyse…</> : <><MIcon name="movie" size={16} /> Reproduire</>}
          </button>
        </div>
        <div className="genai-platforms" style={{ justifyContent: 'space-between' }}>
          <span><MIcon name="check_circle" size={13} /> Fonctionne avec <b>TikTok</b> · <b>Instagram Reels</b> · <b>YouTube Shorts</b> (10 min max)</span>
          {quota && (quota.remainingVideos > 0 || !quota.deepinfra ? (
            <span
              className={`veo-quota${quota.remainingVideos <= 0 ? ' empty' : ''}`}
              title={`Vidéos parlées (Veo) sur le quota GRATUIT Google du jour (~8 scènes/vidéo, reset vers 9 h).${quota.deepinfra ? ' Ensuite, Veo continue automatiquement via DeepInfra (payé à la seconde).' : ''}`}
            >
              <MIcon name="movie" size={13} /> ≈ {quota.remainingVideos} vidéo{quota.remainingVideos > 1 ? 's' : ''} Veo gratuite{quota.remainingVideos > 1 ? 's' : ''} aujourd’hui
            </span>
          ) : (
            <span className="veo-quota empty" title="Quota Veo gratuit épuisé pour aujourd'hui (remise à zéro vers 9 h). Les scènes parlées passent sur un moteur de repli — moins bon que Veo. Pour rester en Veo : générer demain, ou activer le Veo payant (~1,20 $/scène).">
              <MIcon name="hub" size={13} /> Quota Veo épuisé — moteur de repli (qualité moindre)
            </span>
          ))}
        </div>
      </div>

      {/* Liens mis de côté : à reproduire plus tard, d'un clic. */}
      {saved.length > 0 && (
        <div className="genai-saved clip-anim" style={{ animationDelay: '0.08s' }}>
          <div className="genai-saved-head">
            <h3><MIcon name="bookmark" size={16} /> À reproduire plus tard <span className="genai-saved-n">{saved.length}</span></h3>
          </div>
          {saved.map((s) => {
            const p = platformOf(s.url)
            return (
              <div key={s.url} className="genai-saved-row">
                <div className="genai-saved-ic" title={p.label}><MIcon name={p.icon} size={18} /></div>
                <a className="genai-saved-url" href={s.url} target="_blank" rel="noreferrer" title={s.url}>{s.url}</a>
                <span className="genai-saved-date">{ago(s.addedAt)}</span>
                <button className="btn xsmall" onClick={() => reproduceSaved(s.url)} disabled={busy}><MIcon name="movie" size={13} /> Reproduire</button>
                <button className="btn xsmall icon-btn" onClick={() => removeSaved(s.url)} title="Retirer de la liste"><MIcon name="delete" size={15} /></button>
              </div>
            )
          })}
        </div>
      )}

      {/* Comment ça marche — 4 étapes illustrées. */}
      <div className="genai-steps clip-anim" style={{ animationDelay: '0.1s' }}>
        {([
          ['upload', 'Téléchargement', 'La vidéo source est récupérée'],
          ['palette', 'Analyse', 'Transcription + style visuel décodés'],
          ['movie', 'Reproduction', 'Recréée à l’identique — voix adaptée, scènes animées'],
          ['check_circle', 'Prête', 'Arrive dans « Clips », prête à publier']
        ] as const).map(([icon, title, desc], i) => (
          <div key={title} className="genai-step">
            <div className="genai-step-ic"><MIcon name={icon} size={18} /></div>
            <div>
              <div className="genai-step-t"><span className="genai-step-n">{i + 1}</span>{title}</div>
              <div className="muted small">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {busy && (
        <div className="genai-progress clip-anim" style={{ marginTop: 12 }}>
          <div className="small" style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MIcon name="progress_activity" size={14} spin /> Téléchargement → transcription → analyse → écriture…
          </div>
          <div className="muted small" style={{ marginTop: 3 }}>1 à 2 minutes selon la durée de la vidéo source.</div>
        </div>
      )}
      {idea && (
        <div className="idea-card">
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <h3 className="idea-title">{idea.title}</h3>
            <span className="chip" style={{ flexShrink: 0 }}>{idea.niche}</span>
          </div>

          {/* Le hook porte tout le poids du format : on le met en exergue. */}
          <blockquote className="idea-hook">{idea.hook}</blockquote>

          <p className="muted small idea-angle">{idea.angle}</p>

          {/* Déroulé : rail numéroté, bien plus lisible qu'une liste <ol> serrée. */}
          <ol className="idea-steps">
            {idea.script.map((s, i) => (
              <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>
            ))}
          </ol>

          <div className="idea-tags">
            {idea.hashtags.map((h) => <span key={h} className="tag">{h}</span>)}
          </div>

          {/* Prompt de style : long et en anglais → replié, consultable au besoin. */}
          {idea.imageStyle && (
            <details className="idea-style">
              <summary><MIcon name="palette" size={14} /> Style visuel repris de la source</summary>
              <p>{idea.imageStyle}</p>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Estimation AVANT de lancer : une scène par réplique de la source,
                les premières couvertes par le quota Veo gratuit, le reste au tarif
                du moteur choisi. (Le déroulé affiché plus haut reste en français :
                la traduction a lieu à la génération.) */}
            <span className="muted small" style={{ marginRight: 'auto' }}>
              {est ? (
                <>
                  <b style={est.total >= 1 ? { color: 'var(--bad)' } : undefined}>≈ {money(est.total)}</b>
                  {' · '}{est.scenes} scène{est.scenes > 1 ? 's' : ''}
                  {est.free > 0 && <> — {est.free} gratuite{est.free > 1 ? 's' : ''} (quota Veo)</>}
                  {est.free < est.scenes && <>, {est.scenes - est.free} en {quality === 'veo' ? <b>Veo payant</b> : quality === 'seedance' ? <b>Seedance 2.0</b> : quality === 'wan' ? <b>Wan 2.7</b> : 'moteur économique'}</>}
                  {lang === 'en' && ' · dialogues traduits en anglais'}
                </>
              ) : lang === 'en'
                ? 'Le déroulé ci-dessus reste en français : les répliques seront traduites en anglais à la génération.'
                : 'Vidéo montée : voix + images + sous-titres.'}
            </span>
            {/* Langue des dialogues, choisie AU MOMENT de générer. EN : répliques
                traduites, voix natives des moteurs (excellentes en anglais). */}
            <select
              className="genai-lang"
              value={lang}
              onChange={(e) => changeLang(e.target.value as 'fr' | 'en')}
              disabled={launched}
              title="Langue des dialogues de cette vidéo. EN : répliques traduites en anglais, voix natives des moteurs vidéo (bien meilleures en anglais) + moteur Seedance moins cher."
            >
              <option value="fr">🇫🇷 Voix françaises</option>
              <option value="en">🇬🇧 Voix anglaises</option>
            </select>
            {/* Qualité HORS quota gratuit. Le prix est affiché : c'est le seul
                réglage de l'app qui engage de l'argent à chaque clic. */}
            <select
              className="genai-lang"
              value={quality}
              onChange={(e) => setQuality(e.target.value as 'eco' | 'wan' | 'seedance' | 'veo')}
              disabled={launched}
              title="Moteur des scènes parlées UNE FOIS le quota Veo gratuit épuisé. Tant qu'il reste du quota, Veo est utilisé dans tous les cas. Seedance 2.0 : voix native + lip-sync + personnage fidèle, ~30 % moins cher que Veo."
            >
              <option value="eco">⚡ Économique</option>
              <option value="wan">🎯 Wan 2.7 (nos voix + lip-sync)</option>
              <option value="seedance">✨ Seedance 2.0</option>
              <option value="veo">💎 Veo payant</option>
            </select>
            <button className="btn" onClick={() => { setIdea(null); setUrl('') }}>Nouvelle inspiration</button>
            <button className="btn primary" onClick={() => void genVideo()} disabled={launched}>
              {launched
                ? <><MIcon name="check_circle" size={14} /> En cours — arrivera dans « Clips »</>
                : <><MIcon name="movie" size={14} /> Générer la vidéo</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Page « Génération IA » : créer une vidéo ou un diaporama à partir d'un
// TikTok inspirant (l'ancien onglet Inspiration de Générer, en pleine page).
function GenAI({ toast }: { toast: (m: string) => void }): JSX.Element {
  return (
    <>
      <div className="page-head clip-anim">
        <div>
          <h1>Génération IA</h1>
        </div>
      </div>
      <InspireTab toast={toast} />
    </>
  )
}

function Clipage({ sources, clips, progress, onRefresh, toast }: { sources: SourceDTO[]; clips: ClipDTO[]; progress: Record<number, ProgressEvent>; onRefresh: () => Promise<void>; toast: (m: string) => void }): JSX.Element {
  const [url, setUrl] = useState('')
  // Barre latérale : historique (tableau) au repos, avancée + clips pendant/après.
  // `viewId` = génération affichée en détail (choisie ou lancée) ; sinon l'active.
  const [viewId, setViewId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [newSource, setNewSource] = useState<SourceDTO | null>(null)
  const [clipCount, setClipCount] = useState(3)
  // Portion à cliper (en minutes) : proposée quand la vidéo est longue, pour ne
  // traiter qu'un extrait au lieu de télécharger/transcrire des heures de VOD.
  const [fromMin, setFromMin] = useState(0)
  const [lenMin, setLenMin] = useState(15)
  const fileRef = useRef<HTMLInputElement>(null)

  function imported(src: SourceDTO): void {
    setNewSource(src)
    setFromMin(0)
    setLenMin(15)
  }
  async function addUrl(): Promise<void> {
    if (!url.trim()) return
    setBusy(true)
    try {
      // probeSource récupère la durée → l'étape suivante peut proposer un extrait.
      const src = await api.probeSource(url.trim())
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
  // Vidéo « longue » (> 20 min) : on propose de n'en cliper qu'une portion.
  const dur = newSource?.durationSec ?? null
  const isLong = dur != null && dur > 20 * 60
  const totalMin = dur != null ? Math.floor(dur / 60) : 0
  const MAX_LEN = 90 // minutes : au-delà, la transcription dépasse la limite de l'API
  const range = isLong
    ? { startSec: fromMin * 60, endSec: Math.min(dur, fromMin * 60 + Math.min(lenMin, MAX_LEN) * 60) }
    : undefined

  async function launch(): Promise<void> {
    if (!newSource) return
    setBusy(true)
    try {
      await api.runPipeline(newSource.id, clipCount, range)
      toast(`Génération lancée (${clipCount} clip${clipCount > 1 ? 's' : ''})`)
      setViewId(newSource.id) // suit cette génération dans la barre latérale
      setNewSource(null)
      setClipCount(3)
      await onRefresh()
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    } finally {
      setBusy(false)
    }
  }

  // Génération suivie dans la barre latérale : une active (en cours) prime,
  // sinon celle explicitement choisie/lancée (viewId). Rien → historique.
  const active = sources.find((s) => s.status === 'queued' || s.status === 'running')
  const focus = active ?? (viewId != null ? sources.find((s) => s.id === viewId) ?? null : null)
  const focusClips = focus ? clips.filter((c) => c.sourceId === focus.id).sort((a, b) => a.startSec - b.startSec) : []
  const isAiClip = (c: ClipDTO): boolean => (sources.find((s) => s.id === c.sourceId)?.url ?? '').startsWith('idea:')
  // Historique des CLIPAGES : uploads + URL terminés/échoués, du plus récent au
  // plus ancien. On exclut les sources `idea:*` (vidéos/carrousels du pilote auto,
  // pas des découpages lancés ici) qui n'ont rien à faire dans cet historique.
  const history = sources
    .filter((s) => (s.status === 'done' || s.status === 'error') && !(s.url ?? '').startsWith('idea:'))
    .sort((a, b) => b.createdAt - a.createdAt)
  const clipCountBySource = new Map<number, number>()
  for (const c of clips) clipCountBySource.set(c.sourceId, (clipCountBySource.get(c.sourceId) ?? 0) + 1)

  // Avancée de la génération suivie (barre de progression + étape).
  const fp = focus ? progress[focus.id] : undefined
  const focusPct = focus?.status === 'queued' ? 0 : focus?.status === 'done' ? 100 : Math.round((fp?.progress ?? 0) * 100)
  const focusStage = focus?.status === 'queued'
    ? 'En file d’attente'
    : focus?.status === 'done'
      ? 'Terminé'
      : focus?.status === 'error'
        ? focus.error || 'Échec'
        : STAGE_LABELS[fp?.stage ?? 'ingest'] ?? fp?.stage ?? '…'
  const focusRunning = focus?.status === 'queued' || focus?.status === 'running'

  return (
    <div className="clip-layout">
      {/* ── Barre latérale : historique (tableau) au repos ; pendant/après une
          génération, sa progression + les clips qui apparaissent au fil de l'eau. ── */}
      <aside className="clip-side clip-anim">
        {focus ? (
          <>
            <div className="clip-side-head">
              <span className="clip-side-title" title={focus.title || focus.url || ''}>{focus.title || focus.url?.split(/[\\/]/).pop() || `Source #${focus.id}`}</span>
              {focusRunning ? (
                <button
                  className="btn danger-ghost xsmall"
                  title="Annuler la génération"
                  onClick={async () => { try { await api.cancelPipeline(focus.id); toast('Génération annulée'); await onRefresh() } catch (e) { toast('Erreur : ' + (e as Error).message) } }}
                ><MIcon name="cancel" size={13} /></button>
              ) : (
                <button className="btn xsmall" title="Retour à l’historique" onClick={() => setViewId(null)}><MIcon name="cancel" size={13} /></button>
              )}
            </div>
            <div className={`clip-prog-line ${focus.status === 'error' ? 'err' : focus.status === 'done' ? 'ok' : ''}`}>
              <MIcon name={focus.status === 'error' ? 'error' : focus.status === 'done' ? 'check_circle' : 'progress_activity'} size={13} spin={focusRunning} />
              <span>{focusStage}{fp?.message && focusRunning ? ` — ${fp.message}` : ''}</span>
            </div>
            <div className="bar" style={{ marginBottom: 14 }}><div style={{ width: `${focusPct}%`, transition: 'width .4s' }} /></div>

            <div className="clip-side-sub">{focusClips.length} clip{focusClips.length > 1 ? 's' : ''}{focusRunning ? ' — en cours…' : ''}</div>
            {focusClips.length === 0 ? (
              <div className="clip-side-empty">{focusRunning ? 'Les clips apparaîtront ici au fil de la génération.' : 'Aucun clip produit.'}</div>
            ) : (
              <div className="clip-side-clips">
                {focusClips.map((c) => (
                  <div key={c.id} className="clip-mini clip-anim" title={c.title ?? undefined}>
                    <div className="clip-mini-thumb">
                      {c.filePath ? (
                        /\.(jpe?g|png|webp)$/i.test(c.filePath)
                          ? <img src={clipUrl(c.filePath)} alt="" loading="lazy" />
                          : <video src={clipUrl(c.filePath)} preload="metadata" muted />
                      ) : <MIcon name="movie" size={16} />}
                    </div>
                    <div className="clip-mini-body">
                      <div className="clip-mini-title">{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
                      <div className="clip-mini-meta">{isAiClip(c) ? 'IA' : 'Découpe'} · {Math.max(1, Math.round(c.endSec - c.startSec))}s</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="clip-side-head"><span className="clip-side-title">Historique</span></div>
            {history.length === 0 ? (
              <div className="clip-side-empty">Aucune génération pour l’instant.</div>
            ) : (
              <table className="clip-hist">
                <thead><tr><th>Vidéo</th><th>Clips</th></tr></thead>
                <tbody>
                  {history.map((s) => {
                    const ko = s.status === 'error'
                    const n = clipCountBySource.get(s.id) ?? 0
                    return (
                      <tr key={s.id} onClick={() => setViewId(s.id)} title="Voir les clips">
                        <td>
                          <div className="clip-hist-row">
                            <MIcon name={ko ? 'error' : 'check_circle'} size={13} style={{ color: ko ? 'var(--bad)' : 'var(--ap-green-strong)', flexShrink: 0 }} />
                            <span className="clip-hist-title">{s.title || s.url?.split(/[\\/]/).pop() || `Source #${s.id}`}</span>
                          </div>
                          <div className="clip-hist-date">{new Date(s.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</div>
                        </td>
                        <td className="clip-hist-n">{ko ? '—' : n}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </aside>

      {/* ── Espace de travail : import + réglages ── */}
      <div className="clip-workspace">
      <div className="page-head clip-anim">
        <div>
          <h1>Clipage</h1>
        </div>
      </div>

      {/* 1) SOURCE — les deux moyens d'import visibles en même temps (plus d'onglets).
          Une fois une vidéo chargée, la zone se replie sur un récapitulatif. */}
      <div className="card clip-hero clip-anim" style={{ animationDelay: '0.05s' }}>
        {!newSource ? (
          <div className="clip-src">
            <div className="clip-src-col">
              <div className="clip-src-h"><Icon name="upload" size={15} /> Importer un fichier</div>
              <div
                className={`dropzone dz-big ${dragging ? 'drag' : ''}`}
                onClick={() => uploadPct === null && fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void uploadFile(f) }}
              >
                <div className="dz-icon"><Icon name="upload" size={26} /></div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{uploadPct !== null ? `Upload en cours… ${uploadPct}%` : 'Glisse ton fichier vidéo ici'}</div>
                <div className="small" style={{ marginTop: 5 }}>ou clique pour parcourir · mp4, mov, mkv, webm</div>
              </div>
              {uploadPct !== null && <div className="bar" style={{ marginTop: 12 }}><div style={{ width: `${uploadPct}%` }} /></div>}
              <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
            </div>
            <div className="clip-src-sep"><span>ou</span></div>
            <div className="clip-src-col">
              <div className="clip-src-h"><Icon name="twitch" size={15} /> Depuis une VOD Twitch</div>
              <input className="input-full" placeholder="twitch.tv/videos/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
              <button className="btn primary" style={{ marginTop: 10, justifyContent: 'center' }} onClick={addUrl} disabled={busy || !url.trim()}>
                {busy ? 'Analyse…' : <><Icon name="twitch" size={15} /> Charger la VOD</>}
              </button>
              <p className="muted small" style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.4 }}>
                <MIcon name="movie" size={14} style={{ marginTop: 1, flexShrink: 0 }} /> Colle le lien d’une VOD Twitch. Pour un long live, tu choisiras juste après la portion à analyser.
              </p>
            </div>
          </div>
        ) : (
          <div className="clip-selected">
            <div className="clip-selected-ic"><MIcon name="movie" size={20} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newSource.title || newSource.url?.split(/[\\/]/).pop()}</div>
              <div className="muted small" style={{ marginTop: 2 }}>Vidéo prête{dur != null ? ` · ${fmtDur(dur)}` : ''}</div>
            </div>
            <button className="btn small" style={{ flexShrink: 0 }} onClick={() => setNewSource(null)}><MIcon name="cancel" size={14} /> Changer</button>
          </div>
        )}
      </div>

      {/* 2) PARAMÈTRES — toujours affichés. La portion n'apparaît que pour une
          vidéo longue chargée. Le bouton n'est actif qu'une fois la vidéo prête. */}
      <div className="card clip-config clip-anim" style={{ animationDelay: '0.1s' }}>
        {isLong ? (
          <div className="sp-note accent" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              <MIcon name="movie" size={14} /> Vidéo longue ({fmtDur(dur!)}) — choisis la portion à cliper
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 120 }}>
                <span className="muted small">Début (minute)</span>
                <input type="number" min={0} max={Math.max(0, totalMin - 1)} value={fromMin}
                  onChange={(e) => setFromMin(Math.max(0, Math.min(totalMin - 1, Math.round(Number(e.target.value)) || 0)))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 120 }}>
                <span className="muted small">Durée à analyser (min, max {MAX_LEN})</span>
                <input type="number" min={1} max={MAX_LEN} value={lenMin}
                  onChange={(e) => setLenMin(Math.max(1, Math.min(MAX_LEN, Math.round(Number(e.target.value)) || 1)))} />
              </label>
            </div>
            {range && (
              <div className="muted small" style={{ marginTop: 8 }}>
                Extrait analysé : <b>{fmtDur(range.startSec)}</b> → <b>{fmtDur(range.endSec)}</b> ({Math.round((range.endSec - range.startSec) / 60)} min). Seule cette portion est téléchargée.
              </div>
            )}
          </div>
        ) : (
          <div className="muted small" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MIcon name="movie" size={14} /> Durée à analyser : {newSource ? 'vidéo entière' : 'toute la vidéo (une portion sera proposée si elle est longue)'}
          </div>
        )}

        <div className="clip-count-head">
          <label className="muted small" style={{ margin: 0 }}>Nombre de clips à générer</label>
          <span className="clip-count-badge">{clipCount}</span>
        </div>
        <input type="range" min={1} max={30} value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} style={{ width: '100%', marginTop: 10 }} />
        <div className="clip-count-scale"><span>1</span><span>30</span></div>

        <button
          className="btn primary clip-launch"
          onClick={launch}
          disabled={!newSource || busy || uploadPct !== null}
          title={!newSource ? 'Importe d’abord une vidéo (fichier ou VOD Twitch)' : undefined}
        >
          {busy ? 'Lancement…' : <><MIcon name="rocket_launch" size={16} /> Lancer la génération</>}
        </button>
      </div>
      </div>
    </div>
  )
}

function History({ sources, clips, onRefresh, toast, goClips }: { sources: SourceDTO[]; clips: ClipDTO[]; progress: Record<number, ProgressEvent>; onRefresh: () => Promise<void>; toast: (m: string) => void; goClips: () => void }): JSX.Element {
  const [tab, setTab] = useState<'all' | 'done' | 'error'>('all')
  const [page, setPage] = useState(0)
  // Nombre de lignes calculé pour remplir PILE la hauteur du tableau (pas de vide
  // ni de scroll) : on mesure l'espace dispo ÷ la hauteur d'une ligne, au resize.
  const tableRef = useRef<HTMLDivElement>(null)
  const [PER, setPER] = useState(7)
  useEffect(() => {
    const el = tableRef.current
    if (!el) return
    const measure = (): void => {
      const head = el.querySelector('.hist-head') as HTMLElement | null
      const row = el.querySelector('.hist-row') as HTMLElement | null
      const rowH = row?.offsetHeight || 56
      const headH = head?.offsetHeight || 42
      const n = Math.max(3, Math.floor((el.clientHeight - headH) / rowH))
      setPER((p) => (p === n ? p : n))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const busy = (s: string): boolean => s === 'running' || s === 'queued'
  const clipCount = (id: number): number => clips.filter((c) => c.sourceId === id).length
  async function run(id: number): Promise<void> {
    try {
      await api.runPipeline(id, clipCount(id) || 3)
      await onRefresh()
      toast('Génération relancée')
    } catch (e) {
      toast(`Erreur : ${String((e as Error).message)}`)
    }
  }

  // Historique des CLIPAGES : uploads + URL, hors sources idea:* (pilote auto).
  const all = sources
    .filter((s) => !(s.url ?? '').startsWith('idea:'))
    .sort((a, b) => b.createdAt - a.createdAt)
  const nDone = all.filter((s) => s.status === 'done').length
  const nErr = all.filter((s) => s.status === 'error').length
  const filtered = tab === 'done' ? all.filter((s) => s.status === 'done') : tab === 'error' ? all.filter((s) => s.status === 'error') : all
  const pages = Math.max(1, Math.ceil(filtered.length / PER))
  const pg = Math.min(page, pages - 1)
  const rows = filtered.slice(pg * PER, pg * PER + PER)
  const from = filtered.length ? pg * PER + 1 : 0
  const to = Math.min(filtered.length, pg * PER + PER)

  const origin = (s: SourceDTO): string => {
    const u = s.url ?? ''
    if (!u.startsWith('http')) return 'Fichier importé'
    try {
      return new URL(u).hostname.replace(/^www\./, '')
    } catch {
      return 'URL'
    }
  }
  const statusPill = (s: string): JSX.Element => {
    const cls = s === 'done' ? 'ok' : s === 'error' ? 'bad' : ''
    const icon = s === 'done' ? 'check_circle' : s === 'error' ? 'error' : 'progress_activity'
    const lbl = ({ done: 'Terminé', running: 'En cours', queued: 'En attente', error: 'Échec', pending: 'Non lancé' } as Record<string, string>)[s] || s
    return <span className={`hist-badge ${cls}`}><MIcon name={icon} size={13} spin={busy(s)} /> {lbl}</span>
  }
  const goTab = (t: 'all' | 'done' | 'error'): void => { setTab(t); setPage(0) }

  return (
    <div className="hist-fit">
      <div className="page-head clip-anim">
        <div>
          <h1>Historique</h1>
        </div>
      </div>

      <div className="hist-tabs clip-anim" style={{ animationDelay: '0.05s' }}>
        {([['all', 'Toutes', all.length], ['done', 'Terminées', nDone], ['error', 'Échecs', nErr]] as const).map(([t, lbl, n]) => (
          <button key={t} className={`hist-tab${tab === t ? ' on' : ''}`} onClick={() => goTab(t)}>
            {lbl} <span className="hist-tab-n">{n}</span>
          </button>
        ))}
      </div>

      <div ref={tableRef} className="hist-table clip-anim" style={{ animationDelay: '0.1s' }}>
        <div className="hist-head">
          <span>Vidéo</span><span>Statut</span><span>Clips</span><span>Date</span><span />
        </div>
        {rows.length === 0 ? (
          <div className="hist-empty">Aucune génération {tab === 'error' ? 'en échec' : tab === 'done' ? 'terminée' : ''} pour l’instant.</div>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="hist-row">
              <div className="hist-vid">
                <div className="hist-ic"><MIcon name={s.status === 'error' ? 'error' : 'movie'} size={16} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="hist-title" title={s.title || s.url || ''}>{s.title || s.url?.split(/[\\/]/).pop() || `Source #${s.id}`}</div>
                  <div className="muted small hist-sub">#{s.id} · {origin(s)}{s.error ? ` · ${s.error}` : ''}</div>
                </div>
              </div>
              <div>{statusPill(s.status)}</div>
              <div className="hist-n">{s.status === 'error' ? '—' : clipCount(s.id)}</div>
              <div className="muted small hist-date">{new Date(s.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
              <div className="hist-act">
                <button className="btn xsmall" title="Relancer la génération" onClick={() => void run(s.id)} disabled={busy(s.status)}><Icon name="refresh" size={13} /></button>
                <button className="btn xsmall" onClick={goClips}>Voir</button>
              </div>
            </div>
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <div className="hist-foot clip-anim">
          <span className="muted small">{from}–{to} sur {filtered.length}</span>
          <div className="hist-pager">
            <button className="btn xsmall hist-arrow" disabled={pg <= 0} onClick={() => setPage(pg - 1)} aria-label="Page précédente">‹</button>
            <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>{pg + 1} / {pages}</span>
            <button className="btn xsmall hist-arrow" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Page suivante">›</button>
          </div>
        </div>
      )}
    </div>
  )
}

const STATE_LABEL: Record<ClipDTO['publishStatus'], string> = {
  published: 'Publié',
  failed: 'Échec',
  scheduled: 'Programmé',
  unpublished: 'En stock'
}

/** Vignette d'un clip : aperçu 9:16, statut et origine en surimpression, actions en pied. */
const KIND_LABEL: Record<string, string> = { niche: 'Niche', ia: 'IA', clip: 'Découpe' }
function ClipCard({ c, kind, onSetPublishable, perf }: { c: ClipDTO; kind: 'niche' | 'ia' | 'clip'; onSetPublishable: (id: number, value: boolean) => void; perf?: { views: number; x: number } | null }): JSX.Element {
  const published = c.publishStatus === 'published'
  const account = c.publishedAccount || c.profile
  const when = new Date(c.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  return (
    <article className="clip-card">
      <div className="clip-media">
        {/* Un carrousel photo stocke sa couverture (JPEG) : <video> ne l'afficherait pas. */}
        {c.filePath ? (
          /\.(jpe?g|png|webp)$/i.test(c.filePath) ? (
            <img src={clipUrl(c.filePath)} alt="" loading="lazy" />
          ) : (
            <video src={clipUrl(c.filePath)} controls preload="metadata" />
          )
        ) : (
          <div className="clip-noprev"><MIcon name="warning" size={18} /> Pas d’aperçu</div>
        )}
        <span className={`clip-state${published ? ' ok' : c.publishStatus === 'failed' ? ' bad' : ''}`}>
          {STATE_LABEL[c.publishStatus]}
        </span>
        <span className={`clip-kind k-${kind}`}>{KIND_LABEL[kind]}</span>
      </div>
      <div className="clip-body">
        <div className="clip-title" title={c.title ?? undefined}>{c.title || `Clip ${Math.round(c.startSec)}s`}</div>
        {c.hashtags && <div className="clip-tags">{c.hashtags}</div>}
        <div className="clip-meta">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account || '—'}</span>
          <span style={{ flexShrink: 0 }}>{when}</span>
        </div>
        {/* Performance : les vues brutes ET le rapport à la médiane du compte.
            Les vues seules ne disent pas si c'est bon — 5 000 vues est un
            carton sur un compte à 800, un échec sur un compte à 20 000. */}
        {/* Performance ET lien vers la publication sur UNE SEULE ligne. Empilés,
            ils coûtaient 55 px par carte — 110 sur deux rangées, soit tout le
            débordement de l'onglet Publiés. */}
        {(perf || (published && c.postUrl)) && (
          <div className={`clip-perf${perf && perf.x >= 1.5 ? ' hot' : perf && perf.x < 0.6 ? ' cold' : ''}`}>
            {perf ? (
              <>
                <span className="clip-perf-v">{fmtNum(perf.views)} vues</span>
                <span className="clip-perf-x" title={`${perf.x.toFixed(2)}× la médiane de ce compte`}>
                  ×{perf.x >= 10 ? Math.round(perf.x) : perf.x.toFixed(1)}
                </span>
              </>
            ) : (
              <span className="clip-perf-v">Pas de statistique</span>
            )}
            {published && c.postUrl && (
              <a className="clip-post" href={c.postUrl} target="_blank" rel="noreferrer" title="Ouvrir la publication sur TikTok">Voir →</a>
            )}
          </div>
        )}
      </div>
      {/* Toggle « Publiable » (clips non publiés) : par défaut ON. Éteint = clip
          protégé, jamais publié par le pilote auto. Toutes les publications passent
          désormais par le pilote — il n'y a plus de bouton publier/rejeter manuel. */}
      {!published ? (
        <div className="clip-pub">
          <button
            className={`ap-switch mini${c.publishable ? ' on' : ''}`}
            role="switch"
            aria-checked={c.publishable}
            title={c.publishable ? 'Publiable par le pilote — clique pour protéger ce clip' : 'Protégé — clique pour l’autoriser à la publication'}
            onClick={() => onSetPublishable(c.id, !c.publishable)}
          >
            <span className="knob" />
          </button>
          {c.publishable ? <span><b>Publiable</b></span> : <span><MIcon name="block" size={13} /> Protégé</span>}
        </div>
      ) : null}
    </article>
  )
}

function Clips({ clips, sources, onRefresh, toast, scope }: { clips: ClipDTO[]; sources: SourceDTO[]; onRefresh: () => Promise<void>; toast: (m: string) => void; scope: string }): JSX.Element {
  const [tab, setTab] = useState<'stock' | 'published'>('stock')
  async function setPublishable(id: number, value: boolean): Promise<void> {
    try {
      await api.setClipPublishable(id, value)
      await onRefresh()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    }
  }

  // Statistiques par publication (vues, likes…) : elles notent les vidéos
  // publiées. Chargées une fois — l'appel réutilise le cache de 10 min du
  // serveur, partagé avec la page Analyse.
  const [stats, setStats] = useState<Record<number, { views: number; likes: number; comments: number; shares: number; profile: string }>>({})
  const [tri, setTri] = useState<'date' | 'perf'>('date')
  useEffect(() => { api.analyticsAll().then((r) => setStats(r.stats ?? {})).catch(() => undefined) }, [])
  /** Médiane des vues d'un compte, parmi ses publications notées. On compare à la
   *  MÉDIANE et non à la moyenne : un seul carton fausserait la moyenne et ferait
   *  passer tout le reste pour un échec. */
  const medianes = (() => {
    const parCompte: Record<string, number[]> = {}
    for (const v of Object.values(stats)) (parCompte[v.profile] ??= []).push(v.views)
    const out: Record<string, number> = {}
    for (const [u, arr] of Object.entries(parCompte)) {
      const t = arr.slice().sort((x, y) => x - y)
      out[u] = t.length ? (t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : 0
    }
    return out
  })()
  /** Score = vues rapportées à la médiane du compte. Les vues brutes seules
   *  avantageraient mécaniquement les vidéos les plus anciennes. */
  const scoreOf = (c: ClipDTO): { views: number; x: number } | null => {
    const st = stats[c.id]
    if (!st) return null
    const med = medianes[st.profile] || 0
    return { views: st.views, x: med > 0 ? st.views / med : 1 }
  }

  // Import d'une vidéo déjà montée. `null` = aucun envoi en cours ; le bouton
  // reste bloqué pendant, sinon deux envois simultanés se disputeraient la barre.
  const fileRef = useRef<HTMLInputElement>(null)
  const [upPct, setUpPct] = useState<number | null>(null)
  const importer = async (f: File): Promise<void> => {
    setUpPct(0)
    try {
      await api.uploadClip(f, {}, (r) => setUpPct(Math.round(r * 100)))
      toast('Vidéo importée — elle est en stock')
      await onRefresh()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setUpPct(null)
    }
  }

  // Origine du clip (IA depuis une idée, ou découpe d'une vidéo source) — affichée
  // sur la vignette, ce qui remplace l'ancienne séparation en deux onglets.
  const aiIds = new Set(sources.filter((s) => (s.url ?? '').startsWith('idea:')).map((s) => s.id))
  // Nature d'un clip, d'apres son motif de creation. Les clips CREES AVANT que
  // le motif ne distingue les niches restent en « IA » : on ne peut pas deviner
  // apres coup, et une etiquette fausse serait pire qu'une etiquette large.
  const kindOf = (c: ClipDTO): 'niche' | 'ia' | 'clip' =>
    c.reason === 'Vidéo de niche' ? 'niche'
      : (c.reason === 'Vidéo générée depuis une idée' || aiIds.has(c.sourceId)) ? 'ia'
        : 'clip'
  // Portée : « Tous les comptes » → tout ; sinon uniquement les clips du profil choisi.
  const forProfile = (c: ClipDTO): boolean => scope === ALL_SCOPE || c.profile === scope || c.publishedAccount === scope
  const mine = clips.filter(forProfile)
  const byDate = (a: ClipDTO, b: ClipDTO): number => b.createdAt - a.createdAt
  const published = mine.filter((c) => c.publishStatus === 'published').sort(byDate)
  const stock = mine.filter((c) => c.publishStatus !== 'published').sort(byDate)
  const PAR_PAGE = 12
  const [page, setPage] = useState(1)

  // Onglet Publiés : tri par performance possible. Les vidéos SANS statistique
  // (au-delà des 20 dernières d'un compte, limite de l'API) partent en fin de
  // liste plutôt que d'être comptées comme des zéros — on ne sait pas, ce n'est
  // pas un échec.
  const list = tab !== 'published'
    ? stock
    : tri === 'date'
      ? published
      : published.slice().sort((x, y) => {
          const sx = scoreOf(x)
          const sy = scoreOf(y)
          if (!sx && !sy) return y.createdAt - x.createdAt
          if (!sx) return 1
          if (!sy) return -1
          return sy.x - sx.x
        })

  // ── Pagination ────────────────────────────────────────────────────────────
  // Chaque vignette monte un <video>. À 360 publications, l'onglet devenait
  // impraticable — en test, un navigateur sans accélération graphique s'y
  // bloquait franchement. On n'en monte plus que 24 à la fois.
  const nbPages = Math.max(1, Math.ceil(list.length / PAR_PAGE))
  // `page` est BORNÉ plutôt que remis à 1 dans un effet : rester en page 7 d'une
  // liste devenue courte afficherait une grille vide le temps d'un rendu.
  const pageSure = Math.min(page, nbPages)
  const pageList = list.slice((pageSure - 1) * PAR_PAGE, pageSure * PAR_PAGE)
  // Changer d'onglet, de tri ou de compte donne une AUTRE liste : on repart du début.
  useEffect(() => { setPage(1) }, [tab, tri, scope])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clips</h1>
        </div>
        {/* Import direct : la vidéo est DÉJÀ montée, elle ne passe par aucun
            découpage — contrairement à la page Clipage, qui reçoit une source à
            tailler. Réservé à l'onglet « En stock » : importer depuis l'onglet
            des vidéos publiées n'aurait pas de sens. */}
        {tab === 'stock' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importer(f); e.target.value = '' }}
            />
            <button className="btn primary" disabled={upPct !== null} onClick={() => fileRef.current?.click()}>
              {upPct !== null ? `Envoi… ${upPct}%` : <><MIcon name="upload" size={16} /> Importer une vidéo</>}
            </button>
          </>
        )}
      </div>

      {upPct !== null && (
        <div className="bar" style={{ marginBottom: 14 }}><div style={{ width: `${upPct}%`, transition: 'width .2s' }} /></div>
      )}

      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tab ${tab === 'stock' ? 'on' : ''}`} onClick={() => setTab('stock')}>
          <Icon name="clips" size={16} /> En stock <span className="tab-count">{stock.length}</span>
        </button>
        <button className={`tab ${tab === 'published' ? 'on' : ''}`} onClick={() => setTab('published')}>
          <Icon name="send" size={16} /> Publiés <span className="tab-count">{published.length}</span>
        </button>
        {/* Tri par performance : n'apparaît que si des statistiques existent —
            proposer « Meilleures » sans données ne trierait rien. */}
        {tab === 'published' && Object.keys(stats).length > 0 && (
          <div className="clip-tri">
            <button className={tri === 'date' ? 'on' : ''} onClick={() => setTri('date')}>Récentes</button>
            <button className={tri === 'perf' ? 'on' : ''} onClick={() => setTri('perf')}>Meilleures</button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <div className="dz-icon" style={{ margin: '0 auto 12px' }}><Icon name={tab === 'published' ? 'send' : 'clips'} size={24} /></div>
          <div style={{ fontWeight: 500 }}>
            {tab === 'published' ? 'Aucun clip publié pour l’instant' : 'Aucun clip en stock'}
          </div>
          <p className="muted small">
            {tab === 'published'
              ? 'Les clips que tu publies (à la main ou via le pilote auto) apparaîtront ici.'
              : 'Génère une vidéo depuis une idée, ou découpe une vidéo depuis « Générer ».'}
          </p>
        </div>
      ) : (
        <>
          <div className="clip-grid">
            {pageList.map((c) => (
              <ClipCard key={c.id} c={c} kind={kindOf(c)} onSetPublishable={setPublishable} perf={scoreOf(c)} />
            ))}
          </div>
          {nbPages > 1 && (
            <div className="clip-pages">
              <button className="btn" disabled={pageSure <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Précédentes</button>
              <span className="clip-pages-n">
                Page {pageSure} / {nbPages} · {list.length} clip{list.length > 1 ? 's' : ''}
              </span>
              <button className="btn" disabled={pageSure >= nbPages} onClick={() => setPage((p) => Math.min(nbPages, p + 1))}>Suivantes →</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

const CRON_LABELS: Record<string, string> = {
  '*/5 * * * *': 'toutes les 5 min',
  '*/15 * * * *': 'toutes les 15 min',
  '*/30 * * * *': 'toutes les 30 min',
  '0 * * * *': 'toutes les heures',
  '0 */3 * * *': 'toutes les 3 h'
}

type AutopilotSlot = { user: string; handle: string | null; avatarUrl: string | null; niche: string; ordinal: number; etaHm: number; eta: string; done: boolean; pinned?: boolean; type?: string; subject?: string; hasSeries?: boolean; credits?: number; failed?: boolean; error?: string; music?: string; stockPick?: string; stockKinds?: string; emptyStock?: boolean }
/** Nom lisible d'un morceau (retire le préfixe technique + l'extension du fichier). */
function trackLabel(f: string): string {
  return f.replace(/^[a-z]+-\d+-/i, '').replace(/^\d+-/, '').replace(/\.[^.]+$/, '')
}

/** Voix TTS proposées (les plus dynamiques d'abord). '' = voix par défaut du système. */
const TTS_VOICES: { id: string; label: string }[] = [
  { id: '', label: 'Par défaut (Ash — expressive)' },
  { id: 'ash', label: 'Ash — masculine, expressive et dynamique' },
  { id: 'ballad', label: 'Ballad — masculine, chaleureuse et posée' },
  { id: 'onyx', label: 'Onyx — masculine, grave et dramatique' },
  { id: 'coral', label: 'Coral — féminine, pétillante et énergique' },
  { id: 'nova', label: 'Nova — féminine, jeune et énergique' },
  { id: 'sage', label: 'Sage — féminine, naturelle et douce' },
  { id: 'shimmer', label: 'Shimmer — féminine, douce' },
  { id: 'fable', label: 'Fable — narrative et expressive' },
  { id: 'echo', label: 'Echo — masculine, neutre' },
  { id: 'alloy', label: 'Alloy — neutre' }
]

type AutopilotAccount = { user: string; handle: string | null; avatarUrl: string | null; perDay?: number }
type AutopilotPlan = { enabled: boolean; perDay: number; targetPerDay?: number; stockCount?: number; window: { start: number; end: number }; nowHm: number; day?: number; accounts?: AutopilotAccount[]; slots: AutopilotSlot[] }

// Fenêtre d'édition d'un créneau du planning : heure + type de contenu.
// `quota` = nb de vidéos/jour actuel du compte (pour le bouton Supprimer).
function SlotModal({ slot, quota, onClose, onSaved, toast }: { slot: AutopilotSlot; quota: number; onClose: () => void; onSaved: () => void; toast: (m: string) => void }): JSX.Element {
  const [time, setTime] = useState(slot.eta.match(/^\d{2}:\d{2}$/) ? slot.eta : '12:00')
  const [type, setType] = useState(slot.type ?? 'auto')
  const [subject, setSubject] = useState(slot.subject ?? '')
  const [music, setMusic] = useState(slot.music ?? 'auto')
  // Tirage quand AUCUN clip n'est choisi (type « stock » uniquement) : pioche le
  // plus recent, ou rien. Un creneau portant encore une valeur retiree ('oldest',
  // 'random') retombe sur 'recent' — exactement ce que fait le serveur.
  const [stockPick, setStockPick] = useState(slot.stockPick === 'none' ? 'none' : 'recent')
  // Natures autorisees au tirage. Tableau VIDE = aucune restriction, ce qui
  // evite d'avoir a distinguer « tout coche » de « rien regle ».
  const [stockKinds, setStockKinds] = useState<string[]>((slot.stockKinds ?? '').split(',').filter(Boolean))
  const [tracks, setTracks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Clips « En stock » (non publiés, non rejetés) : publiables tels quels via le type « stock ».
  const [stockClips, setStockClips] = useState<ClipDTO[]>([])
  const musicInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { api.musicList().then((r) => setTracks(r.tracks)).catch(() => undefined) }, [])
  useEffect(() => {
    api.listClips()
      // Tous les clips en stock, protégés INCLUS : les choisir à la main vaut
      // consentement. Seul le tirage automatique les exclut (côté serveur).
      .then((cs) => setStockClips(cs.filter((c) => c.publishStatus !== 'published' && c.reviewStatus !== 'rejected' && c.filePath).sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => undefined)
  }, [])
  // Import d'un MP3 depuis le bloc → stocké dans /data/music (partagé), puis auto-sélectionné pour ce bloc.
  const uploadTrack = async (file: File): Promise<void> => {
    if (!/\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(file.name)) { toast('Format audio non supporté (mp3, m4a, wav, ogg…)'); return }
    setUploading(true)
    try {
      const r = await api.uploadMusic(file)
      const list = await api.musicList()
      setTracks(list.tracks)
      if (r.name && list.tracks.includes(r.name)) setMusic(r.name)
      toast('Musique importée ✓')
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const removeSlot = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.saveAutopilotSlot({ user: slot.user, ordinal: slot.ordinal, reset: true })
      await api.saveAutopilotAccount({ user: slot.user, perDay: Math.max(0, quota - 1) })
      toast(`Créneau supprimé — ${Math.max(0, quota - 1)} vidéo${quota - 1 > 1 ? 's' : ''}/jour pour ce compte`)
      onSaved()
      onClose()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async (reset: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (reset) {
        await api.saveAutopilotSlot({ user: slot.user, ordinal: slot.ordinal, reset: true })
        toast('Créneau remis en automatique')
      } else {
        const [h, m] = time.split(':').map(Number)
        await api.saveAutopilotSlot({
          user: slot.user,
          ordinal: slot.ordinal,
          hm: Number.isFinite(h) && Number.isFinite(m) ? h + m / 60 : null,
          type: type === 'auto' ? null : type,
          subject: ['clip', 'carousel', 'stock'].includes(type) ? subject : null,
          stockPick: type === 'stock' ? stockPick : null,
          stockKinds: type === 'stock' ? stockKinds.join(',') : null,
          music
          // NB : pas de `day` ici — le différé (`from`) est posé UNIQUEMENT à la
          // création d'un bloc depuis « Demain » (bouton +) et survit à cet
          // enregistrement (fusion côté serveur). Différer aussi les ÉDITIONS
          // annulerait l'occurrence du jour d'un bloc existant.
        })
        toast('Créneau personnalisé ✓')
      }
      onSaved()
      onClose()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="side-panel">
      <div className="sp-head line">
        <div className="row" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Avatar url={slot.avatarUrl} name={slot.user} size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.handle ? '@' + slot.handle : slot.user}</div>
              <div className="muted small">Vidéo n°{slot.ordinal} du jour</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span className="ap-time-tag">{slot.eta}</span>
            <button className="btn icon-btn" disabled={busy} title="Fermer" onClick={onClose} style={{ width: 30, height: 30 }}><MIcon name="close" size={16} /></button>
          </div>
        </div>
      </div>

      <div className="sp-body">
        <div className="sp-field">
          <label className="sp-label">Heure de publication</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        <div className="sp-field">
          <label className="sp-label">Type de vidéo</label>
          <select
            className="input-full"
            value={type === 'niche' ? 'auto' : type}
            onChange={(e) => {
              const v = e.target.value
              // Le sujet ne se partage pas avec le mode « stock » : ici c'est un id de clip.
              if ((v === 'stock') !== (type === 'stock')) setSubject('')
              setType(v)
            }}
          >
            <option value="auto">Vidéo de niche (défaut)</option>
            {slot.hasSeries && <option value="serie">Épisode de série</option>}
            <option value="carousel">Carrousel photo — musique imposée par TikTok</option>
            <option value="clip">Clip (rediff live / reportage YouTube)</option>
            <option value="stock">Clip en stock — publier une vidéo déjà prête</option>
          </select>
          {type === 'stock' && (
            <>
              <select className="input-full" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">— Choisir un clip en stock —</option>
                {stockClips.map((c) => {
                  const dur = Math.max(0, Math.round(c.endSec - c.startSec))
                  return <option key={c.id} value={String(c.id)}>{c.publishable ? '' : '🔒 '}{c.title || `Clip n°${c.id}`}{dur > 0 ? ` · ${dur}s` : ''}{c.publishable ? '' : ' · protégé'}</option>
                })}
                {/* Clip enregistré mais plus en stock (publié/supprimé depuis) : sans
                    cette option, le choix semblerait perdu à la réouverture. */}
                {subject && !stockClips.some((c) => String(c.id) === subject) && (
                  <option value={subject}>Clip n°{subject} — plus en stock</option>
                )}
              </select>
              {/* Mode de tirage : n'a de sens QUE sans clip choisi — avec un choix
                  explicite, c'est ce clip qui part, il n'y a rien à tirer. */}
              {!subject && (
                <>
                  <label className="muted small" style={{ display: 'block', marginTop: 12, marginBottom: 4, fontWeight: 500 }}>
                    Sans clip choisi, publier
                  </label>
                  <select className="input-full" value={stockPick} onChange={(e) => setStockPick(e.target.value)}>
                    <option value="recent">Le clip le plus récent</option>
                    <option value="none">Ne rien publier — laisser le créneau vide</option>
                  </select>
                  {/* Natures autorisées au tirage. Tout coché = aucune restriction —
                      c'est aussi ce qu'enregistre le serveur, qui refuse de stocker
                      un filtre qui ne filtre rien.
                      Avec « Ne rien publier », le filtre est sans objet : on le GRISE
                      au lieu de le masquer. Le faire disparaître sans explication
                      laissait chercher un réglage qu'on croyait avoir vu. */}
                  <label className="muted small" style={{ display: 'block', marginTop: 12, marginBottom: 4, fontWeight: 500 }}>
                    Piocher parmi
                    {stockPick === 'none' && <span className="muted"> — sans objet : ce créneau ne publie rien</span>}
                  </label>
                  <div className={`sp-kinds${stockPick === 'none' ? ' off' : ''}`}>
                    {([['niche', 'Niche'], ['ia', 'IA'], ['clip', 'Découpe']] as const).map(([k, lbl]) => {
                      const coche = stockKinds.length === 0 || stockKinds.includes(k)
                      return (
                        <label key={k} className={`sp-kind${coche ? ' on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={coche}
                            onChange={() => {
                              const base = stockKinds.length ? stockKinds : ['niche', 'ia', 'clip']
                              const suiv = base.includes(k) ? base.filter((x) => x !== k) : [...base, k]
                              // Tout décocher n'a aucun sens : le créneau ne
                              // trouverait plus rien. On revient à « tout ».
                              setStockKinds(suiv.length ? suiv : [])
                            }}
                          />
                          {lbl}
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
              <div className="sp-note">
                {stockClips.length === 0
                  ? 'Aucun clip en stock : la page Clips → onglet En stock est vide.'
                  : subject
                    ? 'Publie ce clip précis, sans génération (0 crédit). Une fois publié, le créneau repart sur le stock du moment.'
                    : (
                      <>
                        Publie un clip tel quel, sans génération (0 crédit) — jamais un clip 🔒 protégé (eux ne partent que choisis ici).
                        {stockPick === 'none' && ' Le créneau est sauté : aucune publication, aucune génération de remplacement. Il reste actif et repartira dès que tu le remettras sur « le plus récent » ou que tu choisiras un clip.'}
                      </>
                    )}
              </div>
            </>
          )}
          {type === 'carousel' && (
            <>
              <input className="input-full" value={subject} placeholder="Sujet — ou laisse vide : l'IA suit la niche du compte" onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 8 }} />
              <div className="sp-note">
                6 diapos écrites par l’IA (hook → contenu → chute), une image par diapo, texte incrusté. Publié en post photo natif : <b>TikTok choisit lui-même la musique</b> (impossible d’en joindre une).
              </div>
            </>
          )}
          {!slot.hasSeries && <div className="sp-note">Pour proposer « Épisode de série » : configure la série du compte (<MIcon name="settings" size={13} /> de la ligne → onglet Série).</div>}
          {type === 'clip' && (
            <>
              <input className="input-full" value={subject} placeholder="URL YouTube — ou laisse vide : l'IA choisit la vidéo" onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 8 }} />
              <div className="sp-note">
                URL vide = l'IA cherche elle-même une rediff/un reportage (niche + chaînes préférées du compte, jamais deux fois la même vidéo). L'analyse extrait 3 clips ; chaque bloc publie le meilleur suivant.
              </div>
            </>
          )}
        </div>

        {/* Pas de musique pour les carrousels (photo natif → TikTok l'impose),
            ni pour clip/stock (vidéos déjà montées). */}
        {type !== 'clip' && type !== 'stock' && type !== 'carousel' && (
          <div className="sp-field">
            <label className="sp-label">Musique de fond</label>
            <select className="input-full" value={music} onChange={(e) => setMusic(e.target.value)}>
              {/* « auto » ne veut pas dire « l'IA choisit » : ça veut dire « ne rien
                  imposer ici » → le bloc suit la playlist du compte (rotation), et
                  ce n'est QUE sans playlist que l'IA tranche. */}
              <option value="auto">Automatique — playlist du compte</option>
              <option value="none">Aucune musique</option>
              {tracks.map((t) => <option key={t} value={t}>{trackLabel(t)}</option>)}
              {/* Piste enregistrée mais absente du dossier : sans cette option, le
                  <select> retomberait sur « Automatique » et le choix semblerait perdu. */}
              {music !== 'auto' && music !== 'none' && !tracks.includes(music) && (
                <option value={music}>{trackLabel(music)} — fichier introuvable</option>
              )}
            </select>
            {music === 'auto' && (
              <div className="sp-note">
                Prend la piste suivante de la playlist du compte (<MIcon name="settings" size={13} /> de la ligne → onglet <b>Vidéos de niche</b>), pour que les vidéos alternent. Si aucune piste n’y est cochée, l’IA choisit selon l’ambiance.
              </div>
            )}
            {type === 'serie' && music === 'auto' && <div className="sp-note accent">Exception : les épisodes de série n’ont pas de musique de fond (dialogues seuls). Choisis une piste précise ci-dessus pour en imposer une.</div>}
            <div
              onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f && !uploading) void uploadTrack(f) }}
              onClick={() => !uploading && musicInputRef.current?.click()}
              className="muted small"
              style={{
                border: `1.5px solid ${dragOver ? 'var(--accent-strong)' : 'var(--border)'}`,
                borderRadius: 0,
                padding: 12,
                textAlign: 'center',
                cursor: uploading ? 'default' : 'pointer',
                background: dragOver ? 'var(--panel-2)' : 'transparent',
                marginTop: 10,
                transition: 'border-color .15s, background .15s'
              }}
            >
              {uploading
                ? <><MIcon name="progress_activity" size={14} spin /> Import en cours…</>
                : <><MIcon name="upload" size={14} /> Importer un MP3 — glisse-dépose un fichier ou clique</>}
              <input
                ref={musicInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTrack(f); e.currentTarget.value = '' }}
              />
            </div>
          </div>
        )}
        <div className="sp-note">Ces réglages sont prioritaires sur la répartition automatique et s'appliquent chaque jour jusqu'à modification.</div>
      </div>

      <div className="sp-foot">
        <button className="btn danger-ghost" disabled={busy} onClick={() => void removeSlot()} style={{ marginRight: 'auto' }} title="Retire cette vidéo (baisse la cadence du compte)"><MIcon name="delete" size={15} /> Supprimer</button>
        {(slot.pinned || slot.type) && <button className="btn" disabled={busy} onClick={() => void apply(true)}>Réinitialiser</button>}
        {/* Un créneau « stock » SANS clip choisi est un cas parfaitement valide :
            c'est le mode de tirage automatique juste au-dessus qui décide alors
            quoi publier — ou de ne rien publier. L'ancienne garde imposait un
            choix explicite et rendait ce réglage impossible à enregistrer. */}
        <button className="btn primary" disabled={busy} onClick={() => void apply(false)}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </aside>
  )
}
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

// Fenêtre ⚙️ d'une ligne du planning : tous les réglages du compte
// (cadence, niche, CTA, mode série) — enregistrés pour CE compte uniquement.
function AccountConfigModal({ user, onClose, onSaved, toast }: { user: string; onClose: () => void; onSaved: () => void; toast: (m: string) => void }): JSX.Element {
  const [profile, setProfile] = useState<AutopilotProfile | null>(null)
  const [perDay, setPerDay] = useState(1)
  const [niche, setNiche] = useState('')
  const [ctas, setCtas] = useState<{ niche?: string; serie?: string; custom?: string; clip?: string }>({})
  const [music, setMusic] = useState<string[]>([])
  const [tracks, setTracks] = useState<string[]>([])
  // Fiches de la bibliotheque + celle assignee a ce compte (page Niches).
  const [ficheList, setFicheList] = useState<{ id: string; name: string }[]>([])
  const [ficheId, setFicheId] = useState('')
  const [voice, setVoice] = useState('')
  const [voicePlaying, setVoicePlaying] = useState(false)
  const [elevenVoices, setElevenVoices] = useState<{ id: string; label: string }[]>([])
  const [hasEleven, setHasEleven] = useState(false)
  const [clipChannels, setClipChannels] = useState('')
  const [serie, setSerie] = useState<SeriesCfg>({ enabled: false, title: '', universe: '', episode: 1 })
  const [tab, setTab] = useState<'niche' | 'serie' | 'clips'>('niche')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [chanResults, setChanResults] = useState<{ channel: string; status: string; videos: number; longCount: number; sample?: string }[] | null>(null)

  const testChannels = async (): Promise<void> => {
    setTesting(true)
    setChanResults(null)
    try {
      setChanResults((await api.testClipChannels(clipChannels)).results)
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setTesting(false)
    }
  }
  // `icon` = nom d'un glyphe Material Symbols (cf. icon_names dans index.html).
  const chanLine = (r: { status: string; videos: number; longCount: number; sample?: string }): { icon: string; text: string; color?: string } => {
    switch (r.status) {
      case 'ok':
        return { icon: 'check_circle', text: `Compatible — ${r.videos} vidéo${r.videos > 1 ? 's' : ''} trouvée${r.videos > 1 ? 's' : ''} dont ${r.longCount} longue${r.longCount > 1 ? 's' : ''} (15-120 min)${r.sample ? ` · ex. « ${r.sample.slice(0, 60)} »` : ''}`, color: 'var(--good)' }
      case 'aucune_longue':
        return { icon: 'warning', text: 'Chaîne trouvée mais aucune vidéo de 15-120 min dans les premiers résultats — le choix auto risque de l’ignorer', color: '#b45309' }
      case 'protege':
        return { icon: 'block', text: 'Vidéos protégées : téléchargement impossible via l’API — chaîne inutilisable', color: 'var(--bad)' }
      case 'introuvable':
        return { icon: 'cancel', text: 'Introuvable — vérifie l’orthographe exacte du nom de la chaîne', color: 'var(--bad)' }
      case 'quota':
        return { icon: 'block', text: 'Quota mensuel RapidAPI épuisé — le test, le choix auto et les téléchargements sont bloqués jusqu’à la remise à zéro (ou passe au plan supérieur sur rapidapi.com)', color: 'var(--bad)' }
      default:
        return { icon: 'warning', text: 'Erreur pendant le test — réessaie', color: '#b45309' }
    }
  }

  useEffect(() => {
    api.autopilotState().then((s) => {
      const p = s.profiles.find((x) => x.username === user)
      if (!p) return
      setProfile(p)
      setPerDay(p.perDay)
      setNiche(p.niche)
      setCtas(p.ctas ?? {})
      setMusic(p.music ?? [])
      setVoice(p.voice ?? '')
      setClipChannels(p.clipChannels)
      setSerie(p.series)
    }).catch(() => undefined)
    api.musicList().then((r) => setTracks(r.tracks)).catch(() => undefined)
    // Fiches de la bibliothèque + celle assignée à CE compte (page Niches).
    api.niches().then((r) => {
      setFicheList((r.niches ?? []).map((n) => ({ id: n.id, name: n.name })))
      setFicheId((r.comptes ?? []).find((c) => c.user === user)?.nicheId ?? '')
    }).catch(() => undefined)
    api.ttsVoices().then((r) => {
      setHasEleven(r.elevenlabs)
      setElevenVoices(r.voices.filter((v) => v.provider === 'elevenlabs').map((v) => ({ id: v.id, label: v.label })))
    }).catch(() => undefined)
  }, [user])

  // Écoute un court extrait de la voix sélectionnée (générée à la volée côté serveur).
  // On passe par fetch (et non `new Audio(url)`) pour pouvoir LIRE le message
  // d'erreur du serveur : un <audio> ne sait dire que « ça n'a pas marché », ce
  // qui masquait des causes précises (quota de la clé, voix inconnue…).
  const playVoice = async (): Promise<void> => {
    if (voicePlaying) return
    const v = voice || 'ash'
    setVoicePlaying(true)
    try {
      const res = await fetch(`/api/tts/preview?voice=${encodeURIComponent(v)}`)
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `Erreur ${res.status}`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = new Audio(url)
      const done = (): void => { setVoicePlaying(false); URL.revokeObjectURL(url) }
      a.onended = done
      a.onerror = () => { done(); toast('Lecture impossible') }
      await a.play()
    } catch (e) {
      setVoicePlaying(false)
      toast(`Aperçu indisponible — ${(e as Error).message}`.slice(0, 220))
    }
  }

  // Champ CTA d'un type de vidéo, rendu au bas de l'onglet correspondant
  // (le CTA appliqué à la légende dépend du type du bloc publié).
  const ctaField = (key: 'niche' | 'serie' | 'custom' | 'clip', label: string, ph: string): JSX.Element => (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <label className="muted small" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{label}</label>
      <input className="input-full" value={ctas[key] ?? ''} placeholder={ph} onChange={(e) => setCtas((c) => ({ ...c, [key]: e.target.value }))} />
    </div>
  )

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.saveAutopilotAccount({
        user,
        niche,
        ctas,
        music,
        voice,
        clipChannels,
        // Plus de toggle : la série est « prête » dès que titre + univers sont remplis.
        series: { enabled: !!(serie.title.trim() && serie.universe.trim()), title: serie.title, universe: serie.universe }
      })
      toast('Réglages du compte enregistrés ✓')
      onSaved()
      onClose()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Volet NON modal (le contenu garde sa place à droite et reste cliquable)
          → pas de voile : on ferme via ✕ ou Annuler. */}
      <aside className="side-panel">
        <div className="sp-head">
          <div className="row" style={{ marginBottom: 14, gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Avatar url={profile?.avatarUrl ?? null} name={user} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.handle ? '@' + profile.handle : user}</div>
                {/* Cadence : info en lecture seule (elle se règle sur le planning) —
                    remontée ici depuis l'ancien onglet « Général ». */}
                <div className="muted small" title="S'ajuste sur le planning : bouton + en bout de ligne pour ajouter une vidéo, 🗑 Supprimer sur un bloc pour en retirer une.">
                  {perDay === 0 ? 'En pause' : `${perDay} vidéo${perDay > 1 ? 's' : ''}/jour`} · 9h→23h
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {serie.enabled && <span className="chip">Ép. {serie.episode}</span>}
              <button className="btn icon-btn" disabled={busy} title="Fermer" onClick={onClose} style={{ width: 30, height: 30, fontSize: 16 }}>✕</button>
            </div>
          </div>

          <div className="tabs">
            <button className={`tab ${tab === 'niche' ? 'on' : ''}`} onClick={() => setTab('niche')}>Vidéos de niche</button>
            <button className={`tab ${tab === 'serie' ? 'on' : ''}`} onClick={() => setTab('serie')}>Série</button>
            <button className={`tab ${tab === 'clips' ? 'on' : ''}`} onClick={() => setTab('clips')}>Clips</button>
          </div>
        </div>

        <div className="sp-body">
        {tab === 'niche' && (
          <>
            {/* Fiche de la bibliothèque (page Niches), sinon texte libre. La
                fiche PRIME : quand elle est choisie, le champ libre ne sert plus
                à rien et l'afficher modifiable laisserait croire le contraire. */}
            {ficheList.length > 0 && (
              <>
                <label className="muted small" style={{ display: 'block', marginBottom: 4 }}>Niche du compte</label>
                <select
                  className="input-full"
                  value={ficheId}
                  onChange={(e) => { setFicheId(e.target.value); void api.assignNiche(user, e.target.value).catch(() => toast('Assignation impossible')) }}
                  style={{ marginBottom: 10 }}
                >
                  <option value="">Texte libre ci-dessous</option>
                  {ficheList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </>
            )}
            <label className="muted small" style={{ display: 'block', marginBottom: 4 }}>
              {ficheId ? 'Texte libre (ignoré tant qu’une fiche est choisie)' : 'Niche / thème des vidéos classiques'}
            </label>
            <input className="input-full" value={niche} disabled={!!ficheId} placeholder="ex. mystères non résolus, sport, psychologie…" onChange={(e) => setNiche(e.target.value)} />
            {ficheId && (
              <div className="sp-note">
                Ce compte suit la fiche « {ficheList.find((f) => f.id === ficheId)?.name} ». Modifie-la sur la page Niches — elle sert peut-être à d’autres comptes.
              </div>
            )}

            {/* Voix off du compte : une voix différente par compte diversifie le "son"
                (utile contre la détection de contenu IA) et casse l'effet monotone. */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <label className="muted small" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Voix off du compte</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                {/* Les deux familles cohabitent : le fournisseur découle de la voix choisie. */}
                <select className="input-full" style={{ flex: 1 }} value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {TTS_VOICES.map((v) => <option key={v.id || 'default'} value={v.id}>{v.label}</option>)}
                  {elevenVoices.length > 0 && (
                    <optgroup label="ElevenLabs — voix humaines">
                      {elevenVoices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </optgroup>
                  )}
                </select>
                <button className="btn" type="button" onClick={() => void playVoice()} disabled={voicePlaying} title="Écouter un extrait de cette voix" style={{ flexShrink: 0 }}>
                  {voicePlaying ? <MIcon name="progress_activity" size={14} spin /> : <MIcon name="play_arrow" size={14} />} Écouter
                </button>
              </div>
            </div>

            {ctaField('niche', 'CTA des vidéos de niche', 'ex. 🔗 Mon guide est en bio')}

            {/* Playlist : réglage du COMPTE (elle sert aussi aux séries dont le bloc
                impose une piste) — logée ici, l'onglet principal du compte. */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <label className="muted small" style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>Musique du compte</label>
              {tracks.length === 0 ? (
                <div className="muted small">Aucune musique disponible — ajoute des pistes dans Réglages → Musique, ou importe un MP3 depuis un bloc du planning.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                    {tracks.map((t) => {
                      const i = music.indexOf(t)
                      return (
                        <label key={t} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: i >= 0 ? 'var(--ap-green-soft)' : 'transparent' }}>
                          <input
                            type="checkbox"
                            checked={i >= 0}
                            onChange={(e) => setMusic((m) => (e.target.checked ? [...m, t] : m.filter((x) => x !== t)))}
                            style={{ flexShrink: 0 }}
                          />
                          {/* Le numéro montre l'ordre de passage dans la rotation. */}
                          {i >= 0 && <span className="ap-time" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ap-green-deep)', flexShrink: 0 }}>{i + 1}</span>}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trackLabel(t)}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="muted small">
                    {music.length === 0
                      ? '➜ Aucune cochée : choix automatique par l’IA.'
                      : `➜ ${music.length} piste${music.length > 1 ? 's' : ''} en rotation, dans l’ordre affiché.`}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {tab === 'serie' && (
          <>
            {serie.title.trim() && <div className="row" style={{ marginBottom: 10, justifyContent: 'flex-end' }}><span className="chip">Ép. {serie.episode}</span></div>}
            <label className="muted small" style={{ display: 'block', marginBottom: 4 }}>Titre de la série</label>
            <input className="input-full" value={serie.title} placeholder="ex. L’île des fruits skibidi" onChange={(e) => setSerie((s) => ({ ...s, title: e.target.value }))} style={{ marginBottom: 10 }} />
            <label className="muted small" style={{ display: 'block', marginBottom: 4 }}>Univers (personnages récurrents + style visuel)</label>
            <textarea className="input-full" rows={4} value={serie.universe} placeholder="Décris les personnages (noms + traits visuels précis) et le style — c’est ce qui garde les personnages identiques d’un épisode à l’autre." onChange={(e) => setSerie((s) => ({ ...s, universe: e.target.value }))} />
            {ctaField('serie', 'CTA des épisodes de série', 'ex. 🔔 Abonne-toi pour la suite !')}
          </>
        )}

        {tab === 'clips' && (
          <>
            <label className="muted small" style={{ display: 'block', marginBottom: 4 }}>Chaînes / sources préférées (optionnel — une par ligne)</label>
            <textarea
              className="input-full"
              rows={3}
              value={clipChannels}
              placeholder={'ex.\nSqueezie\nHugoDécrypte\nZack en roue libre'}
              onChange={(e) => setClipChannels(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <button className="btn" disabled={testing || !clipChannels.trim()} onClick={() => void testChannels()}>
              🧪 {testing ? 'Test en cours…' : 'Tester la compatibilité des chaînes'}
            </button>
            {chanResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {chanResults.map((r) => {
                  const l = chanLine(r)
                  return (
                    <div key={r.channel} className="small" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 500, color: l.color }}><MIcon name={l.icon} size={14} /> {r.channel}</span>{' '}
                      <span style={{ color: l.color }}>{l.text}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {ctaField('clip', 'CTA des clips', 'ex. 👉 Abonne-toi pour + de clips')}
          </>
        )}

        </div>

        <div className="sp-foot">
          <button className="btn" disabled={busy} onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={busy || !profile} onClick={() => void save()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </aside>
    </>
  )
}

// Planning du jour du pilote : blocs cliquables (heure + type par créneau).
// `groupByAccount` : une ligne de blocs par compte (page Pilote auto) ;
// sinon grille chronologique unique (File d'attente).
function TodayPlan({ ideaVideo, toast, scope, groupByAccount, onConfigSaved }: { ideaVideo: IdeaVideoMap; toast: (m: string) => void; scope?: string; groupByAccount?: boolean; onConfigSaved?: () => void }): JSX.Element | null {
  const [plan, setPlan] = useState<AutopilotPlan | null>(null)
  const [editSlot, setEditSlot] = useState<AutopilotSlot | null>(null)
  const [cfgUser, setCfgUser] = useState<string | null>(null)
  const [day, setDay] = useState(0) // 0 = aujourd'hui, 1 = demain
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  // Glissement au pointeur (et non drag HTML5) : la ligne saisie suit vraiment le
  // curseur, et les lignes traversées s'écartent en direct. Le drag HTML5 ne
  // promenait qu'un fantôme de la poignée, d'où l'impression que rien ne bougeait.
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null)
  const dragRef = useRef<{ from: number; to: number } | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  // Jour actuellement AFFICHÉ — mis à jour à chaque rendu. Les réponses réseau
  // sont validées contre lui, pas contre le jour demandé : sinon une réponse en
  // retard de l'ancien onglet passerait encore son propre test.
  const dayRef = useRef(day)
  dayRef.current = day
  const load = useCallback((): void => {
    const asked = day
    // Garde d'ordre : en basculant Aujourd'hui ↔ Demain, une réponse en retard
    // de l'ancien jour peut arriver APRÈS celle du nouveau et écraser l'affichage
    // (blocs « Publiée » d'aujourd'hui rendus sous l'onglet Demain).
    api.autopilotPlan(asked).then((p) => {
      if ((p.day ?? 0) === dayRef.current) setPlan(p)
    }).catch(() => undefined)
  }, [day])
  useEffect(() => {
    load()
    const t = window.setInterval(load, 20000)
    return () => window.clearInterval(t)
  }, [load])

  // Génération en cours, D'OÙ QU'ELLE VIENNE (pilote ou page Génération IA) :
  // la dernière entrée « running » des événements SSE. Sert uniquement à la barre
  // de progression en bas de carte — elle ne désigne aucun créneau précis.
  const running = Object.values(ideaVideo).filter((v) => v.status === 'running')
  const activeGen = running.length ? running[running.length - 1] : null
  // Recharge le planning quand une génération démarre ou se termine (états à jour).
  const genKey = activeGen ? activeGen.message : (Object.keys(ideaVideo).length ? 'idle' : 'none')
  useEffect(() => { if (genKey === 'idle') load() }, [genKey, load])


  // Bouton « + » : ajoute une vidéo/jour au compte puis ouvre directement le
  // choix du type (niche / épisode de série / sujet) et de l'heure.
  const addVideo = async (u: string, current: number): Promise<void> => {
    // Cadence RÉELLE du compte, pas le nombre de blocs visibles : la vue du jour
    // masque les blocs différés (créés depuis « Demain ») — compter les blocs
    // affichés ferait retomber la cadence au lieu de l'augmenter.
    const realPerDay = plan?.accounts?.find((a) => a.user === u)?.perDay ?? current
    const next = Math.min(5, Math.max(realPerDay, current) + 1)
    try {
      await api.saveAutopilotAccount({ user: u, perDay: next })
      // Ajout depuis « Demain » : le créneau ne prend vie que demain (sinon le
      // rattrapage le lancerait ce soir si son heure du jour est déjà passée).
      if (day === 1) await api.saveAutopilotSlot({ user: u, ordinal: next, day: 1 })
      const p = await api.autopilotPlan(day)
      setPlan(p)
      onConfigSaved?.()
      const created = p.slots.filter((s) => s.user === u && !s.done).pop()
      if (created) { setCfgUser(null); setEditSlot(created) }
      else toast(`${next} vidéo${next > 1 ? 's' : ''}/jour pour ce compte`)
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    }
  }

  const slots = (plan?.slots ?? []).filter((s) => !scope || scope === ALL_SCOPE || s.user === scope)
  const doneCount = slots.filter((s) => s.done).length
  const totalCredits = slots.reduce((sum, s) => sum + (s.credits ?? 0), 0)
  const nextIdx = slots.findIndex((s) => !s.done)
  const nextKey = nextIdx >= 0 ? `${slots[nextIdx].user}-${slots[nextIdx].ordinal}` : null
  // Vue par compte : on garde toujours la carte (une ligne par compte, même à 0
  // vidéo/jour). Vue « File d'attente » : on masque la carte si rien aujourd'hui
  // (comportement d'origine), mais on la garde en vue « Demain » (sélecteur).
  if (!plan?.enabled) return null
  if (!groupByAccount && day === 0 && slots.length === 0) return null

  /** Nom lisible d'une catégorie, pour l'en-tête d'un bloc. */
  const CAT_LABEL: Record<string, string> = {
    niche: 'Niche', serie: 'Série', custom: 'Sujet',
    carousel: 'Carrousel', slideshow: 'Carrousel', clip: 'Clip', stock: 'En stock'
  }
  /** Le serveur compose « Catégorie : sujet ». On sépare les deux pour les
   *  afficher différemment — la catégorie porte la couleur, le sujet le sens. */
  const splitLabel = (s: AutopilotSlot): { cat: string; sujet: string } => {
    const i = s.niche.indexOf(' : ')
    if (i > 0) return { cat: s.niche.slice(0, i), sujet: s.niche.slice(i + 3) }
    return { cat: s.type ? (CAT_LABEL[s.type] ?? 'Niche') : 'Niche', sujet: s.niche }
  }

  const renderBlock = (s: AutopilotSlot, opts?: { hideAvatar?: boolean }): JSX.Element => {
    // PLUS d'etat « creation » sur un creneau : rien ne dit que la generation en
    // cours est celle du pilote — une video lancee a la main depuis Generation IA
    // marquait le prochain creneau du planning, qui n y etait pour rien. Seule la
    // barre en bas de carte signale une generation, sans pretendre savoir laquelle.
    const generating = false
    const { cat, sujet } = splitLabel(s)
    // Un créneau sans type n'est PAS indécis : le pilote y produira une vidéo de
    // niche, facturée. L'annoncer « à définir » laisserait croire que rien ne
    // partira, alors que c'est l'inverse — d'où l'affichage de sa niche.
    const libre = false
    const statut = s.done ? 'publiée'
      : s.failed ? 'échec'
        : generating ? 'création…'
          : s.emptyStock ? 'sans clip'
            : libre ? 'à définir' : 'à venir'
    const teinte = catColor(s.type)
    return (
      <button
        key={`${s.user}-${s.ordinal}-${s.done ? 'pub' : 'up'}`}
        className={`ap-slot${s.done ? ' done' : ''}${generating ? ' gen' : ''}${s.failed ? ' bad' : ''}${s.emptyStock ? ' empty' : ''}${libre ? ' free' : ''}`}
        onClick={() => { if (!s.done) { setCfgUser(null); setEditSlot(s) } }}
        title={s.failed ? `Échec : ${s.error ?? ''} — clique pour changer / retenter` : s.done ? s.niche : `${s.niche} — clique pour personnaliser (heure, type)`}
        style={{ ['--slot' as string]: teinte } as CSSProperties}
      >
        <div className="ap-slot-top">
          <span className="ap-slot-h">{s.eta}</span>
          <span className="ap-slot-ic">
            {s.failed && <MIcon name="error" size={12} />}
            {!s.done && !s.failed && (s.pinned || s.type) && <MIcon name="push_pin" size={12} />}
            {!s.done && !s.failed && s.music && s.music !== 'auto' && (
              <MIcon name={s.music === 'none' ? 'music_off' : 'music_note'} size={12} />
            )}
            {s.done && <MIcon name="check_circle" size={12} />}
          </span>
        </div>
        <div className="ap-slot-lbl">
          <span className="ap-slot-dot" />
          {libre ? 'Créneau libre' : <><b>{cat}</b>{sujet && sujet !== cat ? <> · {sujet}</> : null}</>}
        </div>
        <div className="ap-slot-bot">
          {s.credits != null ? <span className="ap-slot-cr">{s.credits} cr</span> : <span />}
          <span className="ap-slot-st">{statut}</span>
        </div>
      </button>
    )
  }

  // Lignes (mode par compte) : TOUS les comptes configurés, même ceux à 0 vidéo/jour,
  // pour pouvoir en réactiver un qui n'a aucune vidéo prévue. Repli sur les comptes
  // présents dans les créneaux si le serveur ne renvoie pas la liste.
  const scopedAcc = (a: AutopilotAccount): boolean => !scope || scope === ALL_SCOPE || a.user === scope
  const accountList: AutopilotAccount[] = (plan?.accounts?.length
    ? plan.accounts
    : [...new Set(slots.map((s) => s.user))].map((u) => {
        const s = slots.find((x) => x.user === u)
        return { user: u, handle: s?.handle ?? null, avatarUrl: s?.avatarUrl ?? null }
      })
  ).filter(scopedAcc)

  // Ordre local : appliqué tout de suite au dépôt (le serveur le persiste ensuite),
  // sinon la ligne reviendrait à sa place jusqu'au prochain rechargement du plan.
  const ordered = localOrder
    ? accountList.slice().sort((a, b) => {
        const ia = localOrder.indexOf(a.user)
        const ib = localOrder.indexOf(b.user)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })
    : accountList

  // Écart appliqué aux lignes traversées = hauteur de la ligne saisie + le gap
  // de la colonne, pour qu'elles libèrent exactement sa place. La MÊME constante
  // sert au `gap` CSS de la colonne : les deux ne peuvent pas diverger.
  const GAP = 8
  const startDrag = (e: ReactPointerEvent<HTMLElement>, index: number): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const rects = ordered
      .map((a) => rowRefs.current.get(a.user))
      .map((el) => (el ? el.getBoundingClientRect() : null))
    const own = rects[index]
    if (!own) return
    const startY = e.clientY
    dragRef.current = { from: index, to: index }
    setDrag({ from: index, to: index, dy: 0, h: own.height })

    const move = (ev: PointerEvent): void => {
      const dy = ev.clientY - startY
      const center = own.top + own.height / 2 + dy
      let to = index
      rects.forEach((r, i) => {
        if (!r || i === index) return
        const mid = r.top + r.height / 2
        if (i < index && center < mid) to = Math.min(to, i)
        if (i > index && center > mid) to = Math.max(to, i)
      })
      dragRef.current = { from: index, to }
      setDrag((d) => (d ? { ...d, dy, to } : d))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d || d.to === d.from) return
      const next = ordered.map((a) => a.user)
      const [moved] = next.splice(d.from, 1)
      next.splice(d.to, 0, moved)
      setLocalOrder(next)
      api.saveAccountOrder(next).catch(() => toast('Ordre non enregistré'))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Décalage visuel d'une ligne pendant le glissement. */
  const dragStyle = (i: number): CSSProperties => {
    if (!drag) return {}
    if (i === drag.from) {
      return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 3 }
    }
    const shift = drag.h + GAP
    const t = drag.from < i && i <= drag.to ? -shift : drag.to <= i && i < drag.from ? shift : 0
    return { transform: `translateY(${t}px)`, transition: 'transform .18s cubic-bezier(.2,.8,.2,1)' }
  }

  return (
    <div className="card ap-plan-card">
      <div className="row" style={{ marginBottom: 0 }}>
        {/* Onglets ET avancement sur UNE SEULE ligne, comme la référence : c'est
            aussi ce qui rend la hauteur aux blocs, devenus plus généreux. Les
            styles des onglets passent en CSS (.ap-seg) — ils étaient en ligne, ce
            qui obligeait à dupliquer chaque valeur pour exprimer l'état actif. */}
        <div className="ap-bar">
          <div className="ap-seg">
            {([[0, 'Aujourd’hui'], [1, 'Demain']] as const).map(([d, lbl]) => (
              <button key={d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{lbl}</button>
            ))}
          </div>
          {day === 0 && slots.length > 0 ? (
            <div className="ap-day">
              <div className="ap-prog wide"><div style={{ width: `${(doneCount / slots.length) * 100}%` }} /></div>
              <span className="ap-day-n">{doneCount}/{slots.length} publiées</span>
            </div>
          ) : (
            <span className="muted small">
              {slots.length} vidéo{slots.length > 1 ? 's' : ''} prévue{slots.length > 1 ? 's' : ''} demain
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Légende : sans elle, les teintes des blocs ne sont que de la
              décoration — rien ne dit ce qu'un liseré vert-jaune signifie. */}
          <span className="cat-legend">
            {CAT_LEGENDE.map((c) => (
              <span key={c.key} className="cat-legend-i">
                <span className="cat-legend-d" style={{ background: `var(--cat-${c.key})` }} />
                {c.label}
              </span>
            ))}
          </span>
          {plan.stockCount != null && (
            <span
              className="pill-badge"
              title="Clips prêts en stock (page Clips → En stock) — disponibles pour les créneaux « Clip en stock »"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <MIcon name="movie" size={13} /> {plan.stockCount} en stock
            </span>
          )}
          {totalCredits > 0 && (
            <span className="pill-badge" title="Coût estimé total du jour (aperçu — aucun débit pour l’instant)" style={{ fontVariantNumeric: 'tabular-nums' }}>{totalCredits} cr/jour</span>
          )}
          {/* Vue filtrée sur un compte : le compteur du jour de CE compte, pas le total des 5. */}
          {(() => {
            const n = scope && scope !== ALL_SCOPE ? slots.length : plan.targetPerDay ?? plan.perDay
            return <span className="ap-pill"><span className="dot" /> {n} vidéo{n > 1 ? 's' : ''}/jour</span>
          })()}
        </div>
      </div>
      {groupByAccount ? (
        <div className="ap-rows" style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginTop: 6 }}>
          {ordered.map((a, accIdx) => {
            const u = a.user
            const userSlots = slots.filter((s) => s.user === u)
            const uDone = userSlots.filter((s) => s.done).length
            const uCredits = userSlots.reduce((sum, s) => sum + (s.credits ?? 0), 0)
            return (
              <div
                key={u}
                ref={(el) => { if (el) rowRefs.current.set(u, el); else rowRefs.current.delete(u) }}
                className={`ap-acc-row${drag?.from === accIdx ? ' dragging' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 8, ...dragStyle(accIdx) }}
              >
                <div style={{ width: 236, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Poignée : seule zone « draggable », sinon le glissement partirait
                      aussi depuis les blocs horaires et gênerait leur clic. */}
                  <span
                    className="ap-grip"
                    onPointerDown={(e) => startDrag(e, accIdx)}
                    title="Glisser pour réordonner les comptes"
                  >
                    <MIcon name="drag_indicator" size={16} />
                  </span>
                  <Avatar url={a.avatarUrl} name={u} size={32} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {/* Nom en entier (pas d'ellipsis) : la colonne est assez large. */}
                    <div className="small" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{a.handle ? '@' + a.handle : u}</div>
                    <div className="muted small" style={{ whiteSpace: 'nowrap' }}>{userSlots.length === 0 ? 'Aucune vidéo prévue' : `${uDone}/${userSlots.length} publiée${uDone > 1 ? 's' : ''}${uCredits > 0 ? ` · ${uCredits} cr` : ''}`}</div>
                    {/* Avancement du compte : lisible sans compter les blocs publiés. */}
                    {userSlots.length > 0 && (
                      <div className="ap-prog"><div style={{ width: `${(uDone / userSlots.length) * 100}%` }} /></div>
                    )}
                  </div>
                  <button className="btn icon-btn" title="Réglages du compte (cadence, niche, CTA, série)" onClick={() => { setEditSlot(null); setCfgUser(u) }} style={{ width: 30, height: 30, flexShrink: 0 }}>
                    <Icon name="settings" size={14} />
                  </button>
                </div>
                <div className="ap-slots" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, alignItems: 'stretch' }}>
                  {userSlots.map((s) => renderBlock(s, { hideAvatar: true }))}
                  <button
                    className="btn ap-add"
                    disabled={userSlots.length >= 5}
                    onClick={() => void addVideo(u, userSlots.length)}
                    title={userSlots.length >= 5 ? 'Maximum atteint (5 vidéos/jour)' : 'Ajouter une vidéo (choix du type et de l’heure)'}
                    style={{ width: 44, borderRadius: 0, justifyContent: 'center', padding: 0, fontSize: 20, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ap-rows" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          {slots.map((s) => renderBlock(s))}
        </div>
      )}
      {!groupByAccount && slots.length === 0 && (
        <div className="muted small" style={{ marginTop: 14 }}>Aucune vidéo prévue {day === 1 ? 'demain' : "aujourd'hui"}.</div>
      )}
      {/* Bandeau de génération : sa place est RÉSERVÉE en permanence, même à vide.
          Sinon son apparition volait 26 px à la liste des comptes, qui se mettait
          alors à défiler — et toute la carte sautait au démarrage d'une
          génération. Une ligne compacte : jauge et message côte à côte. */}
      {day === 0 && (
        <div className="ap-gen">
          {activeGen && (
            <>
              <div className="bar"><div style={{ width: `${genPct(activeGen.message)}%`, transition: 'width 0.4s ease', background: 'var(--ap-green)' }} /></div>
              <span className="ap-gen-m">{activeGen.message}</span>
            </>
          )}
        </div>
      )}
      {editSlot && (
        <SlotModal
          slot={editSlot}
          // Cadence RÉELLE du compte (les blocs différés sont masqués sur la vue
          // du jour) : « Supprimer » décrémente ce chiffre, pas le nombre visible.
          quota={plan?.accounts?.find((a) => a.user === editSlot.user)?.perDay ?? slots.filter((x) => x.user === editSlot.user).length}
          onClose={() => setEditSlot(null)}
          onSaved={() => {
            load()
            onConfigSaved?.()
          }}
          toast={toast}
        />
      )}
      {cfgUser && (
        <AccountConfigModal
          user={cfgUser}
          onClose={() => setCfgUser(null)}
          onSaved={() => {
            load()
            onConfigSaved?.()
          }}
          toast={toast}
        />
      )}
    </div>
  )
}


/**
 * Réglage de l'API de tendances, avec un bouton « Tester » qui montre les tags
 * RÉELLEMENT extraits : on juge la qualité des données avant de payer un plan.
 */
function TrendsSetup({ toast, onDone }: { toast: (m: string) => void; onDone: () => void }): JSX.Element {
  const [host, setHost] = useState('')
  const [path, setPath] = useState('')
  const [hasKey, setHasKey] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tags: string[] } | { error: string } | null>(null)
  useEffect(() => {
    api.trendsConfig().then((c) => { setHost(c.host); setPath(c.path); setHasKey(c.hasKey) }).catch(() => undefined)
  }, [])

  const saveAndTest = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      await api.saveTrendsConfig(host, path)
      const r = await api.testTrends()
      setResult({ tags: r.tags })
      if (r.tags.length) { toast(`${r.tags.length} tendance${r.tags.length > 1 ? 's' : ''} récupérée${r.tags.length > 1 ? 's' : ''} ✓`); onDone() }
    } catch (e) {
      setResult({ error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>Testé le 21/07/2026 :</b> les deux principales API de tendances de RapidAPI sont mortes —
        <i> TikTok Trending Data</i> (earned) renvoie <code>410 Gone</code> sur ses trois endpoints, et
        <i> TikTok Creative Center API</i> (Lundehund) répond <code>{'{"data":null,"msg":"deprecated"}'}</code> sur
        toute sa section Trends, y compris avec ses paramètres documentés. Attention au badge « 100 % de
        disponibilité » : <b>« deprecated » est renvoyé en HTTP 200</b>, donc l’API paraît saine tout en ne
        renvoyant rien. Ne paie aucun plan sans avoir testé ici.
      </p>
      <p className="muted small">
        Si tu trouves une API qui fonctionne, branche-la ci-dessous : le test affiche les tags réellement extraits.
        Sans elle, les idées sont générées sur la niche du compte — ce qui reste le levier principal.
      </p>
      {!hasKey && <p className="small" style={{ color: 'var(--bad)' }}>Clé RapidAPI absente — ajoute-la d’abord dans les Réglages.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input-full" style={{ flex: '1 1 260px' }} value={host} onChange={(e) => setHost(e.target.value)} placeholder="Hôte RapidAPI — ex. tiktok-trending-data.p.rapidapi.com" />
        <input className="input-full" style={{ flex: '1 1 200px' }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="Chemin — ex. /trending/hashtags" />
        <button className="btn primary" disabled={busy || !path.trim()} onClick={() => void saveAndTest()}>
          {busy ? 'Test…' : 'Enregistrer et tester'}
        </button>
      </div>
      {result && 'error' in result && (
        <p className="small" style={{ color: 'var(--bad)', marginBottom: 0 }}>Échec : {result.error}</p>
      )}
      {result && 'tags' in result && (
        result.tags.length === 0 ? (
          <p className="small" style={{ color: '#b45309', marginBottom: 0 }}>
            L’API a répondu, mais aucun tag n’a pu être extrait — le format de réponse ne correspond pas. Essaie un autre endpoint.
          </p>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {result.tags.slice(0, 20).map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
        )
      )}
    </div>
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
          <TrendsSetup toast={toast} onDone={loadTrends} />
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
          <div style={{ fontWeight: 600, fontSize: 16 }}>{idea.title}</div>
          <div className="small" style={{ marginTop: 4 }}><b>Hook :</b> {idea.hook}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {onGenVideo && <button className="btn primary small" onClick={onGenVideo} disabled={gen?.status === 'running'}>{gen?.status === 'running' ? 'Génération…' : '🎬 Vidéo'}</button>}
          <button className="btn small" onClick={onCopy}>Copier</button>
          {onDelete && <button className="btn small" onClick={onDelete} title="Supprimer">🗑</button>}
        </div>
      </div>
      {gen && (
        <div className="small" style={{ marginTop: 8, fontWeight: 500, color: gen.status === 'error' ? '#b91c1c' : gen.status === 'done' ? 'var(--good)' : 'var(--accent-strong)' }}>
          {gen.status === 'running' ? '⏳ ' : gen.status === 'done' ? '✅ ' : '⚠️ '}{gen.message}
        </div>
      )}
      <div className="muted small" style={{ marginTop: 6 }}><b>Pourquoi ça marche :</b> {idea.angle}</div>
      <div style={{ marginTop: 8 }}>
        <div className="muted small" style={{ fontWeight: 500 }}>Script</div>
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

// Secondes → « 1h23 » / « 12:05 » / « 0:42 » (durées et repères vidéo).
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  return `${m}:${String(ss).padStart(2, '0')}`
}
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k'
  return String(n)
}
function Sparkline({ data }: { data: number[] }): JSX.Element | null {
  if (data.length < 2) return null
  const w = 110, h = 26, max = Math.max(1, ...data)
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Pilote automatique : contenu quotidien autonome par compte ──
type SeriesCfg = { enabled: boolean; title: string; universe: string; episode: number }
type AutopilotProfile = { username: string; handle: string | null; avatarUrl: string | null; niche: string; ctas: { niche?: string; serie?: string; custom?: string; clip?: string }; clipChannels: string; perDay: number; series: SeriesCfg; doneToday: number }
type AutopilotState = { enabled: boolean; perDay: number; busy: boolean; profiles: AutopilotProfile[] }

function Autopilot({ toast, ideaVideo, scope }: { toast: (m: string) => void; ideaVideo: IdeaVideoMap; scope: string }): JSX.Element {
  const [state, setState] = useState<AutopilotState | null>(null)
  const [perDays, setPerDays] = useState<Record<string, number>>({})
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const s = await api.autopilotState()
      setState(s)
      setEnabled(s.enabled)
      const pd: Record<string, number> = {}
      s.profiles.forEach((p) => { pd[p.username] = p.perDay })
      setPerDays(pd)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const toggle = async (): Promise<void> => {
    const v = !enabled
    setEnabled(v)
    setSaving(true)
    try {
      // N'envoie QUE l'interrupteur : les réglages par compte se gèrent via ⚙️.
      await api.saveAutopilot({ enabled: v })
      toast(v ? 'Pilote auto activé' : 'Pilote auto désactivé')
      await load()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const runNow = async (): Promise<void> => {
    try { await api.runAutopilotNow(); toast('Cycle lancé — suis la progression en bas à droite'); window.setTimeout(() => void load(), 1500) }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }

  const profiles = state?.profiles ?? []
  // Cadence affichée à côté de l'interrupteur : celle du compte choisi si un
  // compte est sélectionné, sinon le total des 5.
  const scopedProfiles = profiles.filter((p) => scope === ALL_SCOPE || p.username === scope)
  const totalPerDay = scopedProfiles.reduce((s, p) => s + (perDays[p.username] ?? p.perDay), 0)

  return (
    <div className="ap-fit">
      <div className="page-head">
        <div><h1>Pilote automatique</h1></div>
        <div className="ap-switch-wrap">
          <button
            className="btn icon-btn"
            disabled={!!state?.busy}
            onClick={() => void runNow()}
            title="Générer et publier 1 vidéo maintenant (test)"
          >
            <Icon name="bolt" size={15} />
          </button>
          <div style={{ textAlign: 'right' }}>
            <div className="ap-switch-state">{state?.busy ? 'Génération…' : enabled ? 'En marche' : 'En pause'}</div>
            <div className="muted small">
              {enabled ? `${totalPerDay} vidéo${totalPerDay > 1 ? 's' : ''}/jour` : 'Production suspendue'}
            </div>
          </div>
          <button
            className={`ap-switch${enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? 'Mettre le pilote en pause' : 'Démarrer le pilote'}
            title={enabled ? 'Mettre en pause' : 'Démarrer'}
            disabled={saving}
            onClick={() => void toggle()}
          >
            <span className="knob" />
          </button>
        </div>
      </div>

      <TodayPlan ideaVideo={ideaVideo} toast={toast} scope={scope} groupByAccount onConfigSaved={() => void load()} />
      {profiles.length === 0 && <div className="card muted">Aucun compte upload-post connecté. Ajoute-les dans Réglages.</div>}
    </div>
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

type AnalyseResult = {
  diagnostic: string
  levierPrincipal: string
  recommandations: { titre: string; detail: string; impact: 'fort' | 'moyen' | 'faible'; type: 'systeme' | 'manuel' }[]
  aArreter: string[]
  generatedAt?: number
  cached?: boolean
}

function Analyse({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AnalyseResult | null>(null)
  const run = async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      setRes(await api.analyze(force))
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const impactColor = (i: string): string => (i === 'fort' ? 'var(--ap-green-strong)' : i === 'moyen' ? '#b45309' : 'var(--muted)')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analyse IA</h1>
        </div>
        {res && <button className="btn" disabled={busy} onClick={() => void run(true)}><Icon name="refresh" size={15} /> Relancer</button>}
      </div>

      {!res && !busy && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📊</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Analyse de croissance</div>
          <div className="muted small" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
            L’IA lit les stats réelles de tes 5 comptes (vues, engagement, trajectoire) et les titres de tes vidéos, puis te rend un plan d’action priorisé. Compte ~30 secondes.
          </div>
          <button className="btn green" onClick={() => void run(false)}><Icon name="spark" size={16} /> Lancer l’analyse</button>
        </div>
      )}

      {busy && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>⏳ L’IA analyse tes comptes…</div>
          <div className="muted small">Lecture des stats, des titres et de la trajectoire de chaque compte. ~30 secondes.</div>
        </div>
      )}

      {res && !busy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card ap-banner">
            <div className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Diagnostic</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>{res.diagnostic}</div>
          </div>

          <div className="card" style={{ borderColor: 'var(--ap-green-border)' }}>
            <div className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>⚡ Levier n°1</div>
            <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 500 }}>{res.levierPrincipal}</div>
          </div>

          <div>
            <h3 style={{ margin: '4px 0 10px' }}>Recommandations</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {res.recommandations.map((r, i) => (
                <div key={i} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{r.titre}</span>
                    <span className="chip" style={{ fontSize: 10, color: impactColor(r.impact), background: 'var(--panel-2)' }}>impact {r.impact}</span>
                    <span className="chip" style={{ fontSize: 10 }}>{r.type === 'systeme' ? '⚙️ système' : '🖐 manuel'}</span>
                  </div>
                  <div className="small muted" style={{ lineHeight: 1.5 }}>{r.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {res.aArreter.length > 0 && (
            <div className="card" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
              <div className="small" style={{ fontWeight: 600, color: '#b91c1c', marginBottom: 6 }}>🛑 À arrêter</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: '#7f1d1d' }}>
                {res.aArreter.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {res.generatedAt && (
            <div className="muted small">Analyse du {new Date(res.generatedAt).toLocaleString('fr-FR')}{res.cached ? ' (en cache — « Relancer » pour rafraîchir)' : ''}. Basée sur tes stats réelles ; à recroiser avec ton ressenti terrain.</div>
          )}
        </div>
      )}
    </>
  )
}

// Métadonnées statiques des fournisseurs (rôle + coût) ; l'état vient de /api/providers.
const PROVIDER_META: { id: string; name: string; role: string; cost: string; essential: boolean }[] = [
  { id: 'claude', name: 'Claude (Anthropic)', role: 'Idées, scripts et épisodes de série', cost: '≈ 0,07 $/vidéo · Opus 5 $/1M entrée, 25 $/1M sortie', essential: true },
  { id: 'openai', name: 'OpenAI', role: 'Images des vidéos + voix off TTS', cost: '≈ 0,20 – 0,40 € / vidéo', essential: true },
  { id: 'uploadpost', name: 'upload-post', role: 'Publication automatique sur TikTok', cost: 'Plan payant (TikTok non inclus dans le gratuit)', essential: true },
  { id: 'elevenlabs', name: 'ElevenLabs', role: 'Voix off humaines (option, remplace OpenAI)', cost: '≈ 5 – 22 $/mois selon le volume', essential: false },
  { id: 'gemini', name: 'Gemini (Nano Banana + Veo)', role: 'Images de série cohérentes + scènes parlées Veo', cost: '≈ 1,40 $ / épisode animé', essential: false },
  { id: 'fal', name: 'fal.ai', role: 'Animation des scènes de série (image → vidéo)', cost: '≈ 0,18 $ / scène', essential: false },
  { id: 'deepinfra', name: 'DeepInfra', role: 'Hub média : Veo sans plafond, images, animation, transcription', cost: 'À l’usage — Veo ≈ 1,20 $/scène, image 0,04 $, animation 0,045 $/s', essential: false },
  { id: 'groq', name: 'Groq (Whisper)', role: 'Transcription des clips YouTube', cost: 'Gratuit / quasi nul', essential: false },
  { id: 'rapidapi', name: 'RapidAPI', role: 'Recherche de vidéos à cliper + tendances TikTok', cost: 'Abonnement selon le plan', essential: false },
  { id: 'cookies', name: 'Cookies YouTube', role: 'Débloque le téléchargement des clips', cost: 'Gratuit (à réexporter régulièrement)', essential: false },
  { id: 'proxy', name: 'Proxy résidentiel (Webshare)', role: 'IP française pour télécharger YouTube sans blocage', cost: '≈ 6 $/mois (250 Go)', essential: false }
]

type ProviderLive = { state: 'ok' | 'credits' | 'invalid' | 'error' | 'unconfigured'; detail?: string }
function Providers({ go }: { go: (p: Page) => void }): JSX.Element {
  const [data, setData] = useState<{ voiceProvider: string; seriesEngine: string; providers: Record<string, boolean> } | null>(null)
  const [spend, setSpend] = useState<{ usd: number } | null>(null)
  const [live, setLive] = useState<Record<string, ProviderLive> | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    api.providers().then(setData).catch(() => undefined)
    api.spend().then((s) => setSpend({ usd: s.usd })).catch(() => undefined)
  }, [])
  const runCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      setLive((await api.checkProviders()).providers)
    } catch {
      /* ignore */
    } finally {
      setChecking(false)
    }
  }
  const st = data?.providers ?? {}
  const nConf = PROVIDER_META.filter((p) => st[p.id]).length
  // Petite étiquette contextuelle (voix off active, moteur Veo…).
  const note = (id: string): string | null => {
    if (id === 'openai' && data?.voiceProvider === 'openai') return 'Voix off active'
    if (id === 'elevenlabs' && data?.voiceProvider === 'elevenlabs' && st.elevenlabs) return 'Voix off active'
    if (id === 'elevenlabs' && st.elevenlabs && data?.voiceProvider !== 'elevenlabs') return 'OpenAI est actif'
    if (id === 'gemini' && data?.seriesEngine === 'veo' && st.gemini) return 'Moteur Veo (séries)'
    return null
  }
  // Icône Material par fournisseur.
  const ICON: Record<string, string> = {
    claude: 'auto_awesome', openai: 'image', uploadpost: 'ios_share', elevenlabs: 'record_voice_over',
    gemini: 'auto_awesome_motion', fal: 'animation', deepinfra: 'hub', groq: 'subtitles', rapidapi: 'trending_up',
    cookies: 'cookie', proxy: 'vpn_lock'
  }
  // État unifié : la vérification EN DIRECT prime sur l'état « configuré ».
  const statusOf = (p: { id: string; essential: boolean }): { cls: string; txt: string; title?: string } => {
    const c = live?.[p.id]
    if (c && c.state !== 'unconfigured') {
      if (c.state === 'ok') return { cls: 'ok', txt: 'Opérationnel', title: c.detail }
      if (c.state === 'credits') return { cls: 'bad', txt: 'Crédits épuisés', title: c.detail }
      if (c.state === 'invalid') return { cls: 'bad', txt: 'Clé invalide', title: c.detail }
      if (c.state === 'error') return { cls: 'warn', txt: 'Injoignable', title: c.detail }
    }
    if (st[p.id]) return { cls: 'ok', txt: 'Configuré' }
    if (p.essential) return { cls: 'bad', txt: 'Manquant' }
    return { cls: 'off', txt: 'Non configuré' }
  }
  return (
    <div className="prov-fit">
      <div className="page-head">
        <div>
          <h1>Fournisseurs</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => void runCheck()} disabled={checking} title="Ping chaque service pour vérifier crédits et clé">
            {checking ? <><MIcon name="progress_activity" size={15} spin /> Vérification…</> : <><Icon name="refresh" size={16} /> Vérifier l’état</>}
          </button>
          <button className="btn" onClick={() => go('settings')}><Icon name="settings" size={16} /> Réglages</button>
        </div>
      </div>

      <div className="prov-summary">
        <div>
          <div className="lbl">Fournisseurs configurés</div>
          <div className="val">{nConf}<small> / {PROVIDER_META.length}</small></div>
        </div>
        <div>
          <div className="lbl">Dépense Claude suivie</div>
          <div className="val">{spend ? `$${spend.usd.toFixed(2)}` : '—'}</div>
          <div className="sub">cumul depuis la dernière remise à zéro</div>
        </div>
        <div>
          <div className="lbl">Voix off active</div>
          <div className="val">{data?.voiceProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'}</div>
          <div className="sub">Séries : moteur {data?.seriesEngine === 'veo' ? 'Veo (voix native)' : data?.seriesEngine ?? '—'}</div>
        </div>
      </div>

      <div className="prov-grid">
        {PROVIDER_META.map((p) => {
          const on = !!st[p.id]
          const n = note(p.id)
          const s = statusOf(p)
          return (
            <div key={p.id} className={`prov-tile ${on ? '' : p.essential ? 'is-missing' : 'is-off'}`}>
              <div className="prov-ic"><MIcon name={ICON[p.id] ?? 'extension'} size={21} /></div>
              <div className="prov-body">
                <div className="prov-name">
                  <span>{p.name}</span>
                  {p.essential && <span className="prov-tag">essentiel</span>}
                  {n && <span className="prov-tag alt">{n}</span>}
                </div>
                <div className="prov-role">{p.role}</div>
                <div className="prov-cost">{p.cost}</div>
              </div>
              <span className={`prov-status ${s.cls}`} title={s.title}><i />{s.txt}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page « Niches » ────────────────────────────────────────────────────────
// La niche était un texte libre par compte : réécrit à chaque ajustement,
// impossible à réutiliser ailleurs, et invisible sans ouvrir le volet du compte.
// Elle devient une FICHE nommée qu'on assigne. Un compte sans fiche continue de
// tourner sur son texte libre — rien ne casse.
type NicheT = { id: string; name: string; brief: string; hashtags?: string[]; createdAt: number }
type CompteT = { user: string; nicheId: string | null; libre: string; effective: string }

/** Catalogue produits. Un produit est au contenu promotionnel ce qu'une niche
 *  est au tout-venant : le sujet. Avec une différence décisive — ses PHOTOS,
 *  réinjectées comme référence image-à-image pour que le vrai produit
 *  apparaisse. Un produit inventé par l'IA ne vend rien et trompe l'acheteur. */
/** Montage : rejouer UN plan d'une vidéo déjà produite. Une vidéo est presque
 *  toujours ratée par une seule scène — la refaire en entier coûte le prix
 *  complet et jette les plans réussis. */
function MontagePage({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [videos, setVideos] = useState<MontageVideoDTO[]>([])
  const [ouvert, setOuvert] = useState<MontageDTO | null>(null)
  const [consignes, setConsignes] = useState<Record<number, string>>({})
  /** Texte réécrit par plan, tant qu'il n'est pas renvoyé. */
  const [textes, setTextes] = useState<Record<number, string>>({})
  /** Consigne appliquée à TOUS les plans. */
  const [global, setGlobal] = useState('')
  /** Prompt d'image reecrit par plan, tant qu'il n'est pas renvoye. */
  const [prompts, setPrompts] = useState<Record<number, string>>({})
  /** Dernière ligne d'avancement du rendu en cours, s'il y en a un. */
  const [avance, setAvance] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [sel, setSel] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pisteRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  /** Position de la tête de lecture, en secondes. */
  const [tete, setTete] = useState(0)
  const [joue, setJoue] = useState(false)
  const [muet, setMuet] = useState(false)
  // Le fichier est remplacé EN PLACE : sans ce compteur dans l'URL, le
  // navigateur rejouerait la version d'avant depuis son cache.
  const [rev, setRev] = useState(0)
  /** Début d'un plan dans la vidéo assemblée = somme des plans qui précèdent. */
  const debutDe = (i: number): number =>
    (ouvert?.scenes ?? []).slice(0, i).reduce((t, s) => t + (s.durationSec ?? 0), 0)

  // La tête suit la lecture image par image. `timeupdate` ne se déclenche que 4
  // à 5 fois par seconde : la ligne sauterait au lieu de glisser.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const tick = (): void => {
      setTete(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    const demarre = (): void => { setJoue(true); cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(tick) }
    const arrete = (): void => { setJoue(!v.paused && !v.ended); cancelAnimationFrame(rafRef.current); setTete(v.currentTime) }
    v.addEventListener('play', demarre)
    v.addEventListener('pause', arrete)
    v.addEventListener('ended', arrete)
    v.addEventListener('seeked', arrete)
    v.addEventListener('loadedmetadata', arrete)
    return () => {
      cancelAnimationFrame(rafRef.current)
      v.removeEventListener('play', demarre)
      v.removeEventListener('pause', arrete)
      v.removeEventListener('ended', arrete)
      v.removeEventListener('seeked', arrete)
      v.removeEventListener('loadedmetadata', arrete)
    }
  }, [rev, ouvert?.stamp])


  const total = Math.max(0.1, ouvert?.durationSec ?? 0)
  /** Place la tête là où on a cliqué sur la piste (clic ou glisser). */
  const viser = (clientX: number): void => {
    const el = pisteRef.current
    const v = videoRef.current
    if (!el || !v) return
    const r = el.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    v.currentTime = p * total
    setTete(p * total)
  }
  const auPointeur = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Un clic SUR un bloc est géré par le bloc (il sélectionne aussi le plan) —
    // ici on ne traite que le fond de piste, pour ne pas viser deux fois.
    if ((e.target as HTMLElement).closest('.mont-bloc')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    viser(e.clientX)
  }
  const enLecture = (ouvert?.scenes ?? []).findIndex(
    (s, i) => tete >= debutDe(i) && tete < debutDe(i) + (s.durationSec ?? 0)
  )
  const dupliquer = async (): Promise<void> => {
    if (!ouvert) return
    setBusy(-1)
    try {
      await api.duplicateMontage(ouvert.stamp)
      charger()
      toast('Copie créée — elle apparaît dans la liste, et n’est pas publiable')
    } catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(null) }
  }
  const refaireTout = async (): Promise<void> => {
    if (!ouvert) return
    const c = global.trim()
    if (!c) { toast('Décris ce qu’il faut changer sur l’ensemble du clip'); return }
    const n = ouvert.scenes.length
    if (!window.confirm(`Refaire les ${n} plans ? Chacun est régénéré : compte plusieurs minutes, et le coût d’une vidéo entière.`)) return
    try {
      await api.remakeAll(ouvert.stamp, c)
      setGlobal('')
      toast(`Reprise des ${n} plans lancée — suis l’avancement dans la Console, puis recharge`)
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const supprimerPlan = async (i: number): Promise<void> => {
    if (!ouvert) return
    // Le manifeste est la seule trace du texte et du prompt de ce plan : une
    // fois parti, il ne se retrouve pas. D'où la confirmation.
    if (!window.confirm(`Supprimer le plan ${i + 1} ? Son texte et son image seront perdus.`)) return
    setBusy(i)
    try {
      await api.deleteScene(ouvert.stamp, i)
      const frais = await api.montage(ouvert.stamp)
      setOuvert(frais)
      setSel((n) => Math.max(0, Math.min(frais.scenes.length - 1, n > i ? n - 1 : n)))
      setTextes({})
      setConsignes({})
      setRev((n) => n + 1)
      charger()
      toast(`Plan ${i + 1} supprimé — ${frais.scenes.length} plans, ${Math.round(frais.durationSec)} s ✓`)
    } catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(null) }
  }
  const bascule = (): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused || v.ended) void v.play().catch(() => undefined)
    else v.pause()
  }
  /** Saut de plan en plan : sur une pub de six plans de deux secondes, chercher
   *  un raccord à la souris est illusoire. */
  const versPlan = (pas2: number): void => {
    const n = ouvert?.scenes.length ?? 0
    if (!n) return
    const i = Math.max(0, Math.min(n - 1, (enLecture < 0 ? 0 : enLecture) + pas2))
    const v = videoRef.current
    if (!v) return
    v.currentTime = debutDe(i)
    setTete(debutDe(i))
    setSel(i)
  }
  /** Repères de la règle : ~8 marques, sur un pas rond. */
  const pas = [1, 2, 5, 10, 15, 30, 60].find((p) => total / p <= 8) ?? 60
  const marques: number[] = []
  for (let t = 0; t <= total; t += pas) marques.push(t)
  const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  const charger = useCallback((): void => {
    api.montages().then((r) => setVideos(r.videos ?? [])).catch(() => undefined)
  }, [])
  useEffect(() => { charger() }, [charger])
  // Une reprise complète tourne en tâche de fond : sans retour ici, on lance un
  // rendu de plusieurs minutes depuis une page qui ne bouge pas, et on ne sait
  // pas s'il est parti. La Shell reçoit bien les logs, mais ne les descend pas.
  const stampOuvert = ouvert?.stamp
  useEffect(() => {
    if (!stampOuvert) return
    return subscribe({
      onLog: (m) => {
        if (!m.startsWith('Montage — ')) return
        const ligne = m.slice('Montage — '.length)
        setAvance(ligne)
        // Réassemblage terminé : on relit le manifeste pour redécouper la
        // timeline et rafraîchir l'aperçu, sans attendre un rechargement.
        if (/réassemblée/.test(ligne)) {
          void api.montage(stampOuvert)
            .then((f) => { setOuvert(f); setRev((n) => n + 1); setAvance(null); charger() })
            .catch(() => undefined)
        }
      }
    })
  }, [stampOuvert, charger])

  const ouvrir = async (stamp: string): Promise<void> => {
    try { setOuvert(await api.montage(stamp)); setConsignes({}); setSel(0) }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const refaire = async (i: number): Promise<void> => {
    if (!ouvert) return
    const c = (consignes[i] ?? '').trim()
    const origine = ouvert.scenes[i]?.narration ?? ''
    const t = (textes[i] ?? origine).trim()
    const texteChange = t && t !== origine.trim()
    const pOrig = ouvert.scenes[i]?.imagePrompt ?? ''
    const p = (prompts[i] ?? pOrig).trim()
    const promptChange = p && p !== pOrig.trim()
    if (!c && !texteChange && !promptChange) { toast('Change le texte, le prompt, ou décris la correction'); return }
    setBusy(i)
    try {
      await api.remakeScene(ouvert.stamp, i, {
        instruction: c || undefined,
        narration: texteChange ? t : undefined,
        imagePrompt: promptChange ? p : undefined
      })
      // On relit le manifeste plutôt que de rafistoler l'état local : le plan
      // refait a une NOUVELLE durée, donc toute la timeline se redécoupe.
      const frais = await api.montage(ouvert.stamp)
      setOuvert(frais)
      setConsignes((o) => ({ ...o, [i]: '' }))
      setTextes({})
      setPrompts({})
      setRev((n) => n + 1)
      charger()
      toast(`Plan ${i + 1} refait — vidéo réassemblée (${Math.round(frais.durationSec)} s) ✓`)
    } catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(null) }
  }

  if (ouvert) {
    return (
      <>
        <div className="cat-fil">
          <button onClick={() => setOuvert(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Montage
          </button>
          <span className="cat-fil-seg"><span className="cat-fil-sep">/</span><span className="cat-fil-ici">{ouvert.scenes.length} plans</span></span>
        </div>
        {/* Le montage travaille EN PLACE : un plan refait écrase l'ancien, sans
            retour arrière. La copie est le seul filet avant d'y toucher. */}
        <div className="page-head">
          <div><h1>Montage</h1></div>
          <button className="btn small" disabled={busy !== null} onClick={() => void dupliquer()}>
            {busy === -1 ? 'Copie en cours…' : 'Dupliquer avant de retoucher'}
          </button>
        </div>
        <div className="card cat-panel">
          <div className="cat-body">
            {/* `.cat-sec` est en `display: contents` : ses enfants tombent
                directement dans la grille multi-colonnes du panneau. Sans ce
                conteneur qui prend toute la largeur, le banc de montage se
                retrouve écrasé dans une colonne. */}
            <section className="cat-sec">
             <div className="mont-zone">
              <div className="mont-moniteur">
              {/* Pas de `controls` natifs : ils se posent SUR l'image et
                  masquent le bas du plan — précisément la zone des sous-titres,
                  qu'on vient vérifier ici. Le transport vit donc sous le
                  moniteur, et la piste sert de barre de défilement. */}
              <video
                key={rev}
                ref={videoRef}
                className="mont-apercu"
                src={`/media/clips/${encodeURIComponent(ouvert.finalName)}?v=${rev}`}
                playsInline
                onClick={bascule}
              />
              <div className="mont-transport">
                <span className="mont-tc">{mmss(tete)}</span>
                <div className="mont-boutons">
                  <button title="Début" onClick={() => { const v = videoRef.current; if (v) { v.currentTime = 0; setTete(0) } }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 5h2v14H6zM19 5v14l-9-7z" /></svg>
                  </button>
                  <button title="Plan précédent" onClick={() => versPlan(-1)}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5h2v14H8zM20 5v14l-9-7z" /></svg>
                  </button>
                  <button className="lect" title={joue ? 'Pause' : 'Lecture'} onClick={bascule}>
                    {joue
                      ? <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
                      : <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>}
                  </button>
                  <button title="Plan suivant" onClick={() => versPlan(1)}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M14 5h2v14h-2zM4 5v14l9-7z" /></svg>
                  </button>
                  <button
                    title={muet ? 'Rétablir le son' : 'Couper le son'}
                    onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuet(v.muted) } }}
                  >
                    {muet
                      ? <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zM19 9l-4 6h1.5l4-6H19z" /></svg>
                      : <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 010 7v-7z" /></svg>}
                  </button>
                </div>
                <span className="mont-tc">{mmss(ouvert.durationSec)}</span>
              </div>
              </div>
              {/* Banc de montage. Les blocs sont positionnés en COORDONNÉES DE
                  TEMPS (et non en flex-grow) : c'est la seule façon qu'ils
                  s'alignent exactement sur la règle et sur la tête de lecture,
                  qui partagent le même repère. */}
              <div className="mont-tl">
                <div className="mont-regle">
                  {marques.map((m) => (
                    <span key={m} className="mont-tick" style={{ left: `${(m / total) * 100}%` }}>
                      {mmss(m)}
                    </span>
                  ))}
                </div>
                <div
                  className="mont-piste"
                  ref={pisteRef}
                  onPointerDown={auPointeur}
                  onPointerMove={(e) => { if (e.buttons === 1) viser(e.clientX) }}
                >
                  {ouvert.scenes.map((s, i) => (
                    <button
                      key={s.index}
                      className={`mont-bloc${sel === s.index ? ' actif' : ''}${enLecture === i ? ' lit' : ''}`}
                      style={{
                        left: `${(debutDe(i) / total) * 100}%`,
                        width: `${((s.durationSec ?? 0) / total) * 100}%`
                      }}
                      title={s.narration}
                      onClick={() => {
                        setSel(s.index)
                        const v = videoRef.current
                        if (v) { v.currentTime = debutDe(i); setTete(debutDe(i)) }
                      }}
                    >
                      <span className="mont-bloc-n">{s.index + 1}</span>
                      <span className="mont-bloc-d">{(s.durationSec ?? 0).toFixed(1)}s</span>
                    </button>
                  ))}
                  <div className="mont-tete" style={{ left: `${(tete / total) * 100}%` }} />
                </div>
              </div>
              <div className="muted small mont-etat">
                {ouvert.scenes.length} plans
                {enLecture >= 0 ? ` · plan ${enLecture + 1} à l’écran` : ''}
              </div>
             </div>
            </section>
            {/* Consigne de clip. Distincte des retouches de plan : elle
                s'applique à tous, donc elle relance TOUT le rendu — d'où la
                confirmation et l'exécution en tâche de fond. */}
            <section className="cat-sec sous-titres">
              <div className="cat-sub">Tout le clip</div>
              <div className="cat-f wide">
                <label className="cat-lbl">Consigne appliquée aux {ouvert.scenes.length} plans</label>
                <textarea
                  className="input-full cat-ta" rows={2}
                  value={global}
                  placeholder="ex. ambiance plus lumineuse, décor de penderie et non de garage"
                  onChange={(e) => setGlobal(e.target.value)}
                />
              </div>
              {ouvert.idea && (
                <div className="muted small mont-origine">
                  <div><b>Idée d’origine :</b> {ouvert.idea.hook || ouvert.idea.title}</div>
                  {ouvert.idea.angle && <div><b>Angle de vente :</b> {ouvert.idea.angle}</div>}
                  <div>
                    <b>Storyboard écrit par :</b> {ouvert.model ?? 'non enregistré (vidéo antérieure)'}
                    {ouvert.modelActuel && ouvert.model !== ouvert.modelActuel
                      ? ' — un plan refait maintenant partira de ' + ouvert.modelActuel
                      : ''}
                  </div>
                </div>
              )}
              <div className="sty-actions">
                <button className="btn small" disabled={busy !== null || !!avance} onClick={() => void refaireTout()}>
                  Refaire les {ouvert.scenes.length} plans
                </button>
              </div>
              {avance && (
                <div className="mont-avance">
                  <span className="mont-spin" />
                  {avance}
                </div>
              )}
            </section>
            {(() => {
              const s = ouvert.scenes[sel]
              if (!s) return null
              return (
                <section className="cat-sec sous-titres">
                  <div className="cat-sub">Plan {s.index + 1} · {(s.durationSec ?? 0).toFixed(1)} s</div>
                  {/* Le texte commande la voix off ET les sous-titres, qui en
                      sont tirés : le réécrire refait les deux, et change la
                      durée du plan. */}
                  <div className="cat-f wide">
                    <label className="cat-lbl">Texte dit dans ce plan</label>
                    <textarea
                      className="input-full cat-ta" rows={2}
                      value={textes[s.index] ?? s.narration}
                      onChange={(e) => setTextes((o) => ({ ...o, [s.index]: e.target.value }))}
                    />
                  </div>
                  {/* Le prompt d'image est CE QUI FABRIQUE le plan. Le cacher
                      obligeait à corriger à l'aveugle par consignes successives,
                      sans jamais voir ce qu'on corrigeait. */}
                  <div className="cat-f wide">
                    <label className="cat-lbl">Description de l’image envoyée au modèle</label>
                    <textarea
                      className="input-full cat-ta mont-prompt" rows={5}
                      value={prompts[s.index] ?? s.imagePrompt}
                      onChange={(e) => setPrompts((o) => ({ ...o, [s.index]: e.target.value }))}
                    />
                  </div>
                  <div className="cat-f wide">
                    <label className="cat-lbl">Ou décris la correction, elle s’ajoute au prompt</label>
                    <textarea
                      className="input-full cat-ta" rows={2}
                      value={consignes[s.index] ?? ''}
                      placeholder="ex. le produit est déformé, montre-le entier et posé bien à plat sur la tringle"
                      onChange={(e) => setConsignes((o) => ({ ...o, [s.index]: e.target.value }))}
                    />
                  </div>
                  <div className="sty-actions">
                    <button className="btn small" disabled={busy !== null} onClick={() => void refaire(s.index)}>
                      {busy === s.index ? 'Refait le plan…' : 'Refaire ce plan'}
                    </button>
                    <button
                      className="btn small danger-ghost"
                      disabled={busy !== null || ouvert.scenes.length <= 1}
                      title={ouvert.scenes.length <= 1 ? 'Une vidéo garde au moins un plan' : undefined}
                      onClick={() => void supprimerPlan(s.index)}
                    >
                      Supprimer ce plan
                    </button>
                  </div>
                </section>
              )
            })()}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head"><div><h1>Montage</h1></div></div>
      {!videos.length ? (
        <div className="card cat-panel">
          <div className="cat-body">
            <div className="muted small">
              Aucune vidéo retouchable. Seules les vidéos générées depuis l’archivage des plans le sont —
              les plus anciennes ont perdu leurs scènes à l’assemblage.
            </div>
          </div>
        </div>
      ) : (
        <div className="sty-liste">
          {videos.map((v) => (
            <button key={v.stamp} className="card sty-item" onClick={() => void ouvrir(v.stamp)}>
              <div className="sty-nom">{v.title ?? `Vidéo ${v.stamp}`}</div>
              <div className="muted small">{v.scenes} plans · {v.durationSec.toFixed(1)} s</div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function ProduitsPage({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [produits, setProduits] = useState<ProductDTO[]>([])
  const [ouvert, setOuvert] = useState<ProductDTO | null>(null)
  const [busy, setBusy] = useState(false)

  const charger = useCallback((): void => {
    api.products().then((r) => setProduits(r.products ?? [])).catch(() => undefined)
  }, [])
  useEffect(() => { charger() }, [charger])

  const enregistrer = async (): Promise<void> => {
    if (!ouvert?.name.trim()) { toast('Donne un nom au produit'); return }
    setBusy(true)
    try {
      const r = await api.saveProduct({
        id: ouvert.id || undefined,
        name: ouvert.name,
        pitch: ouvert.pitch,
        benefits: ouvert.benefits.join('\n'),
        price: ouvert.price,
        url: ouvert.url,
        inspirations: (ouvert.inspirations ?? []).join('\n')
      })
      setOuvert(r.product)
      charger()
      toast('Produit enregistré ✓')
    } catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(false) }
  }
  const supprimer = async (p: ProductDTO): Promise<void> => {
    if (!window.confirm(`Supprimer « ${p.name} » et ses photos ?`)) return
    try { await api.deleteProduct(p.id); setOuvert(null); charger(); toast('Produit supprimé') }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const ajouterPhoto = async (f: File): Promise<void> => {
    if (!ouvert?.id) { toast('Enregistre le produit avant d’ajouter des photos'); return }
    setBusy(true)
    try { const r = await api.addProductPhoto(ouvert.id, f); setOuvert(r.product); charger() }
    catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(false) }
  }
  const genererVideo = async (p: ProductDTO): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.genProductVideo(p.id)
      toast(`Vidéo lancée : « ${r.title} » — suis l’avancement dans la Console`)
    } catch (e) { toast('Erreur : ' + (e as Error).message) } finally { setBusy(false) }
  }
  const retirerPhoto = async (nom: string): Promise<void> => {
    if (!ouvert?.id) return
    try { const r = await api.deleteProductPhoto(ouvert.id, nom); setOuvert(r.product) }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }

  // ── Fiche d'un produit ────────────────────────────────────────────────────
  if (ouvert) {
    const maj = <K extends keyof ProductDTO>(k: K, v: ProductDTO[K]): void =>
      setOuvert((o) => (o ? { ...o, [k]: v } : o))
    return (
      <>
        <div className="cat-fil">
          <button onClick={() => setOuvert(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Produits
          </button>
          <span className="cat-fil-seg"><span className="cat-fil-sep">/</span><span className="cat-fil-ici">{ouvert.name.trim() || 'Nouveau produit'}</span></span>
        </div>
        <div className="page-head"><div><h1>{ouvert.name.trim() || 'Nouveau produit'}</h1></div></div>
        <div className="card cat-panel">
          <div className="cat-body">
            <section className="cat-sec">
              <div className="cat-f">
                <label className="cat-lbl">Nom du produit</label>
                <input className="input-full" value={ouvert.name} placeholder="tel qu’il apparaît dans la boutique" onChange={(e) => maj('name', e.target.value)} />
              </div>
              <div className="cat-f">
                <label className="cat-lbl">Prix affiché</label>
                <input className="input-full" value={ouvert.price ?? ''} placeholder="ex. 24,90 € — au lieu de 39,90 €" onChange={(e) => maj('price', e.target.value)} />
              </div>
              <div className="cat-f wide">
                <label className="cat-lbl">Lien boutique</label>
                <input className="input-full" value={ouvert.url ?? ''} placeholder="https://…" onChange={(e) => maj('url', e.target.value)} />
              </div>
              <div className="cat-f wide">
                <label className="cat-lbl">Ce que fait le produit, et pour qui</label>
                <textarea className="input-full cat-ta" rows={3} value={ouvert.pitch} placeholder="ex. lampe de bureau sans fil, 3 températures, 40 h d’autonomie — pour étudiants et télétravail en petit espace" onChange={(e) => maj('pitch', e.target.value)} />
              </div>
              <div className="cat-f wide">
                <label className="cat-lbl">Bénéfices, un par ligne</label>
                <textarea
                  className="input-full cat-ta" rows={4}
                  value={ouvert.benefits.join('\n')}
                  placeholder={'se recharge en 2 h\ns’accroche partout sans percer\nne chauffe pas'}
                  onChange={(e) => maj('benefits', e.target.value.split('\n'))}
                />
              </div>
            </section>
            {/* Les photos sont le cœur de la fiche : sans elles, la vidéo montre
                un produit inventé. La PREMIÈRE sert de référence. */}
            <section className="cat-sec sous-titres">
              <div className="cat-sub">Photos du produit</div>
              <div className="muted small sty-intro">
                La première sert de référence : c’est elle que l’IA reprend pour que le vrai produit apparaisse dans chaque plan.
              </div>
              <div className="sty-liste">
                {ouvert.photos.map((nom, i) => (
                  <div key={nom} className="card sty-item">
                    <div className="sty-vign img">
                      <img src={`/api/products/photo/${encodeURIComponent(nom)}`} alt={`Photo ${i + 1}`} />
                    </div>
                    <div className="sty-nom">{i === 0 ? 'Référence' : `Photo ${i + 1}`}</div>
                    <div className="sty-actions">
                      <button className="btn xsmall danger" onClick={() => void retirerPhoto(nom)}>Retirer</button>
                    </div>
                  </div>
                ))}
                <label className={`card sty-ajout${busy ? ' occupe' : ''}`}>
                  <span className="sty-plus">+</span>
                  <span>{busy ? 'Envoi…' : 'Ajouter une photo'}</span>
                  <input
                    type="file" accept="image/*" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void ajouterPhoto(f); e.currentTarget.value = '' }}
                  />
                </label>
              </div>
            </section>
            {/* Décrire une bonne publicité dans un prompt marche moins bien que
                d'en donner une à copier : on en reprend la FORME, jamais le
                contenu — le produit montré reste le nôtre. */}
            <section className="cat-sec sous-titres">
              <div className="cat-sub">Inspirations</div>
              <div className="muted small sty-intro">
                Des pubs qui marchent, une URL par ligne. On en reprend le rythme, le découpage et la
                mécanique — jamais le produit ni le discours. Elles défilent d’une vidéo à l’autre.
              </div>
              <div className="cat-f wide">
                <textarea
                  className="input-full cat-ta" rows={4}
                  value={(ouvert.inspirations ?? []).join('\n')}
                  placeholder={'https://www.tiktok.com/@…/video/…\nhttps://youtube.com/shorts/…'}
                  onChange={(e) => maj('inspirations', e.target.value.split('\n'))}
                />
              </div>
            </section>
          </div>
          <div className="cat-foot">
            <span className="cat-count">
              {!ouvert.id
                ? 'Enregistre d’abord la fiche pour pouvoir y ajouter des photos.'
                : ouvert.photos.length === 0
                  ? 'Ajoute une photo : sans référence, la vidéo montrerait un produit inventé.'
                  : ''}
            </span>
            <button className="btn ghost-sm danger" onClick={() => void supprimer(ouvert)} disabled={!ouvert.id}>Supprimer</button>
            {/* Générer n'a de sens qu'avec une photo : c'est elle qui fait
                apparaître le VRAI produit dans les plans. */}
            <button
              className="btn"
              disabled={busy || !ouvert.id || ouvert.photos.length === 0}
              onClick={() => void genererVideo(ouvert)}
            >
              {busy ? 'Génération…' : 'Générer une vidéo'}
            </button>
            <button className="btn primary" disabled={busy || !ouvert.name.trim()} onClick={() => void enregistrer()}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </>
    )
  }

  // ── Liste ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="page-head">
        <div><h1>Produits</h1></div>
      </div>
      <div className="cat-grid">
        {produits.map((p) => (
          <button key={p.id} className="card cat-card cat-tile" onClick={() => setOuvert(p)}>
            <div className="cat-head">
              {p.photos[0]
                ? <span className="prod-vign"><img src={`/api/products/photo/${encodeURIComponent(p.photos[0])}`} alt="" /></span>
                : <span className="cat-ico"><Icon name="sources" size={16} /></span>}
              <div>
                <div className="cat-title">{p.name}</div>
                <div className="muted small cat-hint">{p.pitch || 'Aucune description — l’IA n’aura que le nom.'}</div>
              </div>
            </div>
            <div className="cat-apercu">
              <div className="cat-ap"><span className="cat-ap-l">Prix</span><span className="cat-ap-v">{p.price || '—'}</span></div>
              <div className="cat-ap"><span className="cat-ap-l">Bénéfices</span><span className="cat-ap-v">{p.benefits.length || '—'}</span></div>
              <div className={`cat-ap${p.photos.length ? ' on' : ''}`}>
                <span className="cat-ap-l">Photos</span>
                <span className="cat-ap-v">{p.photos.length || 'aucune'}</span>
              </div>
            </div>
            <div className="cat-tile-foot">
              <span className={`cat-count${p.photos.length ? ' on' : ''}`}>
                {p.photos.length ? 'Prêt à filmer' : 'Sans photo, le produit sera inventé'}
              </span>
              <span className="cat-go">
                Ouvrir
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </span>
            </div>
          </button>
        ))}
        <button
          className="card sty-ajout prod-ajout"
          onClick={() => setOuvert({ id: '', name: '', pitch: '', benefits: [], photos: [], createdAt: Date.now() })}
        >
          <span className="sty-plus">+</span>
          <span>Nouveau produit</span>
        </button>
      </div>
    </>
  )
}

function NichesPage({ toast }: { toast: (m: string) => void }): JSX.Element {
  const [niches, setNiches] = useState<NicheT[]>([])
  const [comptes, setComptes] = useState<CompteT[]>([])
  const [busy, setBusy] = useState('')
  /** Brouillons locaux : on n'écrit au serveur qu'à l'enregistrement explicite. */
  const [draft, setDraft] = useState<Record<string, { name: string; brief: string; tags: string }>>({})
  // Langue et qualite par fiche : deux niches n ont pas les memes besoins, et
  // le choix ne doit pas survivre d une fiche a l autre.
  const [lang, setLang] = useState<Record<string, string>>({})
  const [qual, setQual] = useState<Record<string, string>>({})

  const charger = useCallback((): void => {
    api.niches().then((r) => {
      setNiches(r.niches ?? [])
      setComptes(r.comptes ?? [])
      const d: Record<string, { name: string; brief: string; tags: string }> = {}
      for (const n of r.niches ?? []) d[n.id] = { name: n.name, brief: n.brief, tags: (n.hashtags ?? []).join(' ') }
      setDraft(d)
    }).catch(() => undefined)
  }, [])
  useEffect(() => { charger() }, [charger])

  const champ = (id: string, k: 'name' | 'brief' | 'tags', v: string): void =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { name: '', brief: '', tags: '' }), [k]: v } }))

  const creer = async (): Promise<void> => {
    setBusy('new')
    try {
      const r = await api.saveNiche({ name: 'Nouvelle niche', brief: '' })
      toast('Niche créée')
      charger()
      // Focus implicite : la nouvelle carte apparaît en fin de liste, prête à
      // être renommée — inutile de la faire remonter, l'ordre reste stable.
      void r
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  const enregistrer = async (id: string): Promise<void> => {
    const d = draft[id]
    if (!d?.name.trim()) { toast('Donne un nom à la niche'); return }
    setBusy(id)
    try {
      await api.saveNiche({ id, name: d.name, brief: d.brief, hashtags: d.tags.split(/[\s,]+/).filter(Boolean) })
      toast('Niche enregistrée ✓')
      charger()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  const supprimer = async (id: string, nom: string, used: CompteT[]): Promise<void> => {
    const avert = used.length
      ? `« ${nom} » est utilisée par ${used.length} compte${used.length > 1 ? 's' : ''} (${used.map((c) => c.user).join(', ')}). Ils reviendront à leur niche par défaut. Supprimer ?`
      : `Supprimer « ${nom} » ?`
    if (!window.confirm(avert)) return
    setBusy(id)
    try {
      await api.deleteNiche(id)
      toast('Niche supprimée')
      charger()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  const importer = async (): Promise<void> => {
    setBusy('import')
    try {
      const r = await api.importNiches()
      toast(r.crees ? `${r.crees} niche${r.crees > 1 ? 's' : ''} importée${r.crees > 1 ? 's' : ''}` : 'Rien à importer')
      charger()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  /** Lance une vidéo depuis la fiche. L'idée intermédiaire est écrite côté
   *  serveur : la page n'a pas à connaître son identifiant pour obtenir une
   *  vidéo. Le suivi passe par le widget de génération, comme partout ailleurs. */
  const produire = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      const r = await api.nicheVideo(id, {
        lang: (lang[id] as 'fr' | 'en') ?? 'fr',
        quality: qual[id] || undefined
      })
      toast(`Vidéo lancée — « ${String(r.title).slice(0, 46)} »`)
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  const assigner = async (user: string, nicheId: string): Promise<void> => {
    setBusy(user)
    try {
      await api.assignNiche(user, nicheId)
      toast('Compte réassigné ✓')
      charger()
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }

  const usedBy = (id: string): CompteT[] => comptes.filter((c) => c.nicheId === id)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Niches</h1>
        </div>
        <button className="btn primary" disabled={busy === 'new'} onClick={() => void creer()}>
          {busy === 'new' ? 'Création…' : '+ Nouvelle niche'}
        </button>
      </div>

      {/* Bibliothèque vide : sans cet écran, la page n'affiche que la carte
          « Comptes » et rien n'indique qu'il faut d'abord créer une fiche pour
          pouvoir produire une vidéo. */}
      {niches.length === 0 && (
        <div className="card nic-empty">
          <div className="cat-title">Aucune niche pour l’instant</div>
          <p className="muted small">
            Une niche est une fiche réutilisable — sujet, angle, hashtags. Une fois créée, elle
            permet de <b>générer une vidéo</b> qui arrive dans « Clips&nbsp;→&nbsp;En stock », et
            de s’assigner à un ou plusieurs comptes.
          </p>
          <div className="nic-empty-a">
            <button className="btn primary" disabled={busy === 'new'} onClick={() => void creer()}>
              {busy === 'new' ? 'Création…' : 'Créer ma première niche'}
            </button>
            <button className="btn" disabled={busy === 'import'} onClick={() => void importer()}>
              {busy === 'import' ? 'Import…' : 'Importer celles de mes comptes'}
            </button>
          </div>
          <div className="muted small nic-empty-h">
            L’import reprend les niches déjà saisies sur tes {comptes.length} comptes et les
            regroupe : deux comptes sur le même sujet partagent une seule fiche.
          </div>
        </div>
      )}

      <div className="nic-grid">
        {niches.map((n) => {
          const d = draft[n.id] ?? { name: n.name, brief: n.brief, tags: '' }
          const used = usedBy(n.id)
          return (
            <div className="card nic-card" key={n.id}>
              <input
                className="input-full nic-name"
                value={d.name}
                placeholder="Nom de la niche"
                onChange={(e) => champ(n.id, 'name', e.target.value)}
              />
              <label className="muted small nic-lbl">Sujet, angle et ton — c’est ce texte qui est transmis à l’IA</label>
              <textarea
                className="input-full nic-brief"
                rows={5}
                value={d.brief}
                placeholder="ex. Histoires vraies méconnues de la science, racontées comme une enquête. Ton posé, chute qui surprend. Pas de sensationnalisme."
                onChange={(e) => champ(n.id, 'brief', e.target.value)}
              />
              <label className="muted small nic-lbl">Hashtags de base</label>
              <input
                className="input-full"
                value={d.tags}
                placeholder="#histoirevraie #science"
                onChange={(e) => champ(n.id, 'tags', e.target.value)}
              />
              {/* Production directe : une vidéo écrite depuis CE brief, qui arrive
                  dans « Clips → En stock » sans être publiée — comme une vidéo
                  lancée depuis Génération IA ou un clip découpé. Langue et
                  qualité se choisissent ici, jamais implicitement : la qualité,
                  c'est de l'argent. */}
              <div className="nic-gen">
                <select className="input-full" value={lang[n.id] ?? 'fr'} onChange={(e) => setLang((l) => ({ ...l, [n.id]: e.target.value }))}>
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                </select>
                <select className="input-full" value={qual[n.id] ?? ''} onChange={(e) => setQual((q) => ({ ...q, [n.id]: e.target.value }))}>
                  <option value="">⚡ Économique</option>
                  <option value="wan">🎯 Wan 2.7 — ~0,50 $/scène</option>
                  <option value="seedance">✨ Seedance 2.0 — ~0,84 $/scène</option>
                  <option value="veo">💎 Veo payant — ~1,20 $/scène</option>
                </select>
                <button className="btn green" disabled={busy === n.id} onClick={() => void produire(n.id)}>
                  {busy === n.id ? 'Lancement…' : <><Icon name="spark" size={14} /> Générer une vidéo</>}
                </button>
              </div>
              <div className="nic-foot">
                <span className="nic-used">
                  {used.length === 0
                    ? 'Aucun compte'
                    : used.map((c) => <span key={c.user} className="nic-chip">{c.user}</span>)}
                </span>
                <button className="btn ghost-sm" disabled={busy === n.id} onClick={() => void supprimer(n.id, n.name, used)}>Supprimer</button>
                <button className="btn primary" disabled={busy === n.id} onClick={() => void enregistrer(n.id)}>
                  {busy === n.id ? '…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )
        })}

      </div>
    </>
  )
}

// ── Page « Catégories » ────────────────────────────────────────────────────
// Troisième axe de personnalisation, à côté du compte et du créneau. Les
// catégories suivent ce qui est PRODUIT — niches, clips de streamers,
// génération manuelle — et non les types internes du planning : une série ou un
// sujet libre restent des vidéos de niche dont on a imposé l'univers ou le
// sujet, ils suivent donc les réglages « Niches ».
type CatGlobals = Record<string, string | number>
/** Libellés lisibles des valeurs héritées : « Réglage global » seul n'apprend
 *  rien — on affiche CE QU'IL VAUT, sinon impossible de juger s'il faut le
 *  surcharger. */
const CAT_MOTS: Record<string, string> = {
  seedance: 'Seedance', veo: 'Veo', pixverse: 'Pixverse', wan: 'Wan 2.7',
  economique: 'Économique', fr: 'Français', en: 'Anglais',
  center: 'Centré', face: 'Suivi du visage', '1': 'Incrustés', '0': 'Aucun'
}
/** Libellés PROPRES À UNE CLÉ, prioritaires sur CAT_MOTS. Plusieurs réglages
 *  partagent les codes '0'/'1' : sans cette table, la casse des sous-titres
 *  s'affichait « Incrustés », le libellé de l'incrustation. */
const CAT_MOTS_CLE: Record<string, Record<string, string>> = {
  subUpper: { '1': 'MAJUSCULES', '0': 'Normale' },
  subtitles: { '1': 'Incrustés', '0': 'Aucun' }
}
/** Réglages dont la valeur est un NOMBRE et non un code. Sans cette liste, un
 *  « 1 » passé dans CAT_MOTS ressort en « Incrustés ». */
const CAT_NOMBRES = new Set(['maxScenes', 'speed', 'slides', 'clipCount', 'subSize', 'subOutline', 'subGroup', 'subBottom'])
/** Champs du style de sous-titres, dans l'ordre envoyé à l'aperçu. */
const SUB_CLES = ['subFont', 'subSize', 'subColor', 'subHilite', 'subOutline', 'subGroup', 'subBottom', 'subUpper']
/** Vignette d'un style : son rendu réel, recadré sur la bande de sous-titres.
 *  Lire « Anton · 86 px » ne dit pas à quoi ça ressemble — c'est l'image qui
 *  permet de choisir. */
function VignetteStyle({ s }: { s: SubStyleDTO }): JSX.Element {
  const [url, setUrl] = useState('')
  const ref = useRef('')
  const cle = `${s.font}|${s.size}|${s.color}|${s.hilite}|${s.outline}|${s.group}|${s.bottom}|${s.upper}`
  useEffect(() => {
    let vivant = true
    const [font, size, color, hilite, outline, group, bottom, upper] = cle.split('|')
    api.subtitlePreview({
      subFont: font, subSize: size, subColor: color, subHilite: hilite,
      subOutline: outline, subGroup: group, subBottom: bottom, subUpper: upper === 'true' ? '1' : '0'
    })
      .then((u) => {
        if (!vivant) { URL.revokeObjectURL(u); return }
        if (ref.current) URL.revokeObjectURL(ref.current)
        ref.current = u
        setUrl(u)
      })
      .catch(() => undefined)
    return () => { vivant = false }
  }, [cle])
  useEffect(() => () => { if (ref.current) URL.revokeObjectURL(ref.current) }, [])
  return (
    <div className="sty-vign">
      {url
        ? <img src={url} alt={`Rendu du style ${s.name}`} style={{ objectPosition: `center ${Math.round(100 - (s.bottom / 1920) * 100 - 4)}%` }} />
        : <span className="sty-vign-vide" />}
    </div>
  )
}

/** Description d'un paramètre : ce qu'il faut pour l'afficher et le résumer.
 *  Une seule table, partagée par l'éditeur et les cartes — deux libellés pour
 *  le même champ finiraient par diverger. */
const PARAM_DEF: Record<string, { label: string; court: string; opts?: [string, string][]; min?: number; max?: number; pas?: string }> = {
  speed: { label: 'Débit de parole', court: 'Débit', min: 0.5, max: 2, pas: '0.05' },
  lang: { label: 'Langue', court: 'Langue', opts: [['fr', 'Français'], ['en', 'Anglais']] },
  subtitles: { label: 'Sous-titres', court: 'Sous-titres', opts: [['1', 'Incrustés'], ['0', 'Aucun']] },
  slides: { label: 'Nombre de diapos', court: 'Diapos', min: 3, max: 10 },
  clipCount: { label: 'Candidats par source', court: 'Candidats', min: 1, max: 10 },
  reframe: { label: 'Cadrage vertical', court: 'Cadrage', opts: [['center', 'Centré'], ['face', 'Suivi du visage']] },
  engine: {
    label: 'Moteur des scènes parlées', court: 'Moteur',
    opts: [['seedance', 'Seedance'], ['veo', 'Veo'], ['pixverse', 'Pixverse'], ['wan', 'Wan 2.7']]
  },
  quality: {
    label: 'Qualité imposée', court: 'Qualité',
    opts: [['wan', 'Wan 2.7 — ~0,50 $/scène'], ['seedance', 'Seedance 2.0 — ~0,84 $/scène'], ['veo', 'Veo payant — ~1,20 $/scène']]
  },
  maxScenes: { label: 'Scènes max', court: 'Scènes', min: 1, max: 60 }
}

/** Vignette d'un style visuel. L'image n'existe que si on l'a demandée : la
 *  générer coûte un appel payant, on ne le fait pas dans le dos de l'utilisateur. */
function VignetteImage({ s, cat, onGen }: { s: ImgStyleDTO; cat: string; onGen: (id: string) => Promise<void> }): JSX.Element {
  // `v` force le navigateur à recharger l'image après une régénération : sans
  // lui, l'URL ne changeant pas, il resservirait l'ancienne depuis son cache.
  const [v, setV] = useState(0)
  const [busy, setBusy] = useState(false)
  const [absent, setAbsent] = useState(false)
  return (
    <div className="sty-vign img">
      {!absent && <img src={`/api/image-styles/preview/${s.id}?v=${v}`} alt={`Aperçu de ${s.name}`} onError={() => setAbsent(true)} />}
      {absent && (
        <button
          className="img-gen"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            setBusy(true)
            void onGen(s.id).then(() => { setAbsent(false); setV((x) => x + 1) }).finally(() => setBusy(false))
          }}
        >
          {busy ? 'Génération…' : 'Générer l’aperçu'}
        </button>
      )}
      {!absent && (
        <button
          className="img-regen"
          title="Régénérer l’aperçu (coûte une image)"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            setBusy(true)
            void onGen(s.id).then(() => setV((x) => x + 1)).finally(() => setBusy(false))
          }}
        >
          <Icon name="refresh" size={12} />
        </button>
      )}
    </div>
  )
}

/** Éditeur d'un style visuel : un nom et une consigne de rendu. */
function ModaleImgStyle({ style, onFerme, onEnregistre }: {
  style: ImgStyleDTO
  onFerme: () => void
  onEnregistre: (s: ImgStyleDTO) => Promise<void>
}): JSX.Element {
  const [s, setS] = useState<ImgStyleDTO>(style)
  const [busy, setBusy] = useState(false)
  return (
    <div className="pal-back" onMouseDown={onFerme}>
      <div className="card sty-modale etroite" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cat-f">
          <label className="cat-lbl">Nom du style</label>
          <input className="input-full" value={s.name} placeholder="ex. Cinéma nocturne" onChange={(e) => setS((o) => ({ ...o, name: e.target.value }))} />
        </div>
        <div className="cat-f">
          <label className="cat-lbl">Consigne de rendu</label>
          <textarea
            className="input-full cat-ta" rows={4}
            placeholder="ex. photographie cinématographique, lumière rasante, grain argentique, palette ocre"
            value={s.prompt}
            onChange={(e) => setS((o) => ({ ...o, prompt: e.target.value }))}
          />
        </div>
        <div className="muted small cat-note" style={{ maxWidth: 'none' }}>
          Décris une TECHNIQUE de rendu, jamais un lieu : la consigne est réinjectée dans chaque scène,
          un décor qui s’y glisserait collerait le même fond à toute la vidéo.
        </div>
        <div className="cat-foot">
          <span className="cat-count">L’aperçu se génère depuis la carte, une fois le style enregistré.</span>
          <button className="btn ghost-sm" onClick={onFerme}>Annuler</button>
          <button
            className="btn primary"
            disabled={busy || !s.name.trim() || !s.prompt.trim()}
            onClick={() => { setBusy(true); void onEnregistre(s).finally(() => setBusy(false)) }}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Éditeur d'un style de sous-titres, avec le rendu réel à côté des champs. */
function ModaleStyle({ style, polices, onFerme, onEnregistre }: {
  style: SubStyleDTO
  polices: [string, string][]
  onFerme: () => void
  onEnregistre: (s: SubStyleDTO) => Promise<void>
}): JSX.Element {
  const [s, setS] = useState<SubStyleDTO>(style)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [rendu, setRendu] = useState(false)
  const ref = useRef('')
  useEffect(() => () => { if (ref.current) URL.revokeObjectURL(ref.current) }, [])

  const cle = JSON.stringify([s.font, s.size, s.color, s.hilite, s.outline, s.group, s.bottom, s.upper])
  useEffect(() => {
    let vivant = true
    setRendu(true)
    const t = window.setTimeout(() => {
      const [font, size, color, hilite, outline, group, bottom, upper] = JSON.parse(cle) as [string, number, string, string, number, number, number, boolean]
      api.subtitlePreview({ subFont: font, subSize: size, subColor: color, subHilite: hilite, subOutline: outline, subGroup: group, subBottom: bottom, subUpper: upper ? '1' : '0' })
        .then((u) => {
          if (!vivant) { URL.revokeObjectURL(u); return }
          if (ref.current) URL.revokeObjectURL(ref.current)
          ref.current = u
          setUrl(u)
        })
        .catch(() => undefined)
        .finally(() => { if (vivant) setRendu(false) })
    }, 400)
    return () => { vivant = false; window.clearTimeout(t) }
  }, [cle])

  const maj = <K extends keyof SubStyleDTO>(k: K, v: SubStyleDTO[K]): void => setS((o) => ({ ...o, [k]: v }))
  const nb = (k: 'size' | 'outline' | 'group' | 'bottom', label: string, min: number, max: number): JSX.Element => (
    <div className="cat-f">
      <label className="cat-lbl">{label}</label>
      <input className="input-full" type="number" min={min} max={max} value={s[k]} onChange={(e) => maj(k, Number(e.target.value))} />
    </div>
  )
  const coul = (k: 'color' | 'hilite', label: string): JSX.Element => (
    <div className="cat-f">
      <label className="cat-lbl">{label}</label>
      <div className="cat-col">
        <input type="color" value={`#${s[k]}`} onChange={(e) => maj(k, e.target.value.replace(/^#/, '').toUpperCase())} />
        <span className="cat-col-hex">#{s[k]}</span>
      </div>
    </div>
  )

  return (
    <div className="pal-back" onMouseDown={onFerme}>
      <div className="card sty-modale" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sty-corps">
          <div>
            <div className="cat-f">
              <label className="cat-lbl">Nom du style</label>
              <input className="input-full" value={s.name} placeholder="ex. Punchy jaune" onChange={(e) => maj('name', e.target.value)} />
            </div>
            <div className="sty-grille">
              <div className="cat-f">
                <label className="cat-lbl">Police</label>
                <select className="input-full" value={s.font} onChange={(e) => maj('font', e.target.value)}>
                  {polices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {nb('size', 'Taille', 30, 200)}
              <div className="cat-f">
                <label className="cat-lbl">Casse</label>
                <select className="input-full" value={s.upper ? '1' : '0'} onChange={(e) => maj('upper', e.target.value === '1')}>
                  <option value="1">MAJUSCULES</option>
                  <option value="0">Normale</option>
                </select>
              </div>
              {nb('group', 'Mots affichés ensemble', 1, 8)}
              {nb('outline', 'Épaisseur du contour', 0, 20)}
              {nb('bottom', 'Hauteur depuis le bas', 40, 1500)}
              {coul('color', 'Couleur du texte')}
              {coul('hilite', 'Mot prononcé')}
            </div>
          </div>
          <aside className="cat-prev">
            <div className="cat-prev-t">Aperçu</div>
            <div className={`cat-prev-box${rendu ? ' load' : ''}`}>
              {url && <img src={url} alt="Rendu du style" />}
            </div>
          </aside>
        </div>
        <div className="cat-foot">
          <span className="cat-count">Ce style pourra être appliqué à n’importe quelle catégorie.</span>
          <button className="btn ghost-sm" onClick={onFerme}>Annuler</button>
          <button
            className="btn primary"
            disabled={busy || !s.name.trim()}
            onClick={() => { setBusy(true); void onEnregistre(s).finally(() => setBusy(false)) }}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoriesPage({ toast, profiles }: { toast: (m: string) => void; profiles: PubProfile[] }): JSX.Element {
  const [cfg, setCfg] = useState<Record<string, Record<string, string | number>>>({})
  const [globals, setGlobals] = useState<CatGlobals>({})
  const [busy, setBusy] = useState('')
  // Copie de référence : sert à savoir si une carte a été touchée (bouton actif)
  // et à annuler proprement.
  const [ref, setRef] = useState<Record<string, Record<string, string | number>>>({})
  // Catégorie ouverte. `null` = la grille de choix. Trois formulaires côte à côte
  // obligeaient à lire chaque champ pour savoir où l'on était ; on choisit
  // d'abord, on règle ensuite.
  const [ouvert, setOuvert] = useState<string | null>(null)
  /** Panneau ouvert dans la catégorie (`null` = la grille des panneaux). Ne sert
   *  qu'aux catégories qui en ont plusieurs. */
  const [ouvertPan, setOuvertPan] = useState<string | null>(null)
  useEffect(() => { setOuvertPan(null) }, [ouvert])
  // Compte dont on règle les catégories. `null` = l'étape de choix du compte.
  const [compte, setCompte] = useState<string | null>(null)
  /** Couche héritée AVANT les globaux : vide en vue tous comptes, la couche
   *  tous comptes quand on regarde un compte précis. */
  const [inherited, setInherited] = useState<Record<string, Record<string, string | number>>>({})
  /** Nombre de déviations par compte — pour l'étape de choix. */
  const [parCompte, setParCompte] = useState<Record<string, number>>({})
  /** Polices réellement installées côté serveur : la liste vient de lui, sinon
   *  on proposerait une police que fontconfig remplacerait en silence. */
  const [polices, setPolices] = useState<[string, string][]>([])
  /** Bibliothèques de styles, une par catégorie. */
  const [stylesParCat, setStylesParCat] = useState<Record<string, StyleLibDTO>>({})
  /** Les clips partagent la bibliotheque de sous-titres des niches. */
  const libDe = (cat: string): StyleLibDTO => stylesParCat[cat === 'clip' ? 'niche' : cat] ?? { styles: [], defaultId: '' }
  /** Bibliothèques de styles VISUELS, une par catégorie. */
  const [imgStylesParCat, setImgStylesParCat] = useState<Record<string, ImgLibDTO>>({})
  const imgLibDe = (cat: string): ImgLibDTO => imgStylesParCat[cat] ?? { styles: [], defaultId: '' }
  const [editImg, setEditImg] = useState<ImgStyleDTO | null>(null)
  /** Bibliothèques de RÉGLAGES nommés, et les champs propres à chaque catégorie. */
  const [presetsParCat, setPresetsParCat] = useState<Record<string, PresetLibDTO>>({})
  const [champsParCat, setChampsParCat] = useState<Record<string, string[]>>({})
  const presetLibDe = (cat: string): PresetLibDTO => presetsParCat[cat] ?? { presets: [], defaultId: '' }
  /** Réglage ouvert en pleine page (`null` = la liste). Son brouillon vit ici :
   *  les styles se choisissent sur la page, on n'enregistre qu'au bouton. */
  const [ouvrePreset, setOuvrePreset] = useState<PresetDTO | null>(null)
  useEffect(() => { setOuvrePreset(null) }, [ouvert, ouvertPan])
  const enregistrePreset = async (cat: string, p: PresetDTO): Promise<void> => {
    const cfg: Record<string, string> = {}
    for (const k of champsParCat[cat] ?? []) cfg[k] = String(p[k] ?? '')
    // Les deux styles font partie du réglage : les omettre les effacerait à
    // chaque enregistrement.
    cfg.imgStyleId = String(p.imgStyleId ?? '')
    cfg.subStyleId = String(p.subStyleId ?? '')
    try {
      const r = await api.saveParamPreset(cat, { id: p.id || undefined, name: p.name, cfg })
      setPresetsParCat(r.parCategorie)
      toast('Réglage enregistré ✓')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const majDefautPreset = async (cat: string, id: string): Promise<void> => {
    try { setPresetsParCat((await api.setDefaultParamPreset(cat, id)).parCategorie); toast('Réglage par défaut changé') }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const supprimePreset = async (cat: string, p: PresetDTO): Promise<void> => {
    if (!window.confirm(`Supprimer le réglage « ${p.name} » ? Les comptes qui l’utilisaient repasseront au réglage par défaut.`)) return
    try { setPresetsParCat((await api.deleteParamPreset(cat, p.id)).parCategorie); toast('Réglage supprimé') }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  /** Bibliothèque de niches et fiche assignée à chaque compte. La niche est le
   *  SUJET du compte — commune à ses vidéos et à ses carrousels, elle vit donc
   *  au niveau de la catégorie et non d'un de ses panneaux. */
  const [nichesLib, setNichesLib] = useState<{ id: string; name: string; brief: string; hashtags?: string[] }[]>([])
  const [nicheParCompte, setNicheParCompte] = useState<Record<string, string | null>>({})
  const chargerNiches = useCallback((): void => {
    api.niches().then((r) => {
      setNichesLib(r.niches ?? [])
      setNicheParCompte(Object.fromEntries((r.comptes ?? []).map((c) => [c.user, c.nicheId])))
    }).catch(() => undefined)
  }, [])
  useEffect(() => { if (compte) chargerNiches() }, [compte, chargerNiches])
  /** L'assignation prend effet TOUT DE SUITE, comme le bouton « Défaut » des
   *  styles : ce n'est pas un champ de formulaire, il n'y a rien à valider. */
  const assigner = async (user: string, id: string): Promise<void> => {
    try {
      await api.assignNiche(user, id)
      setNicheParCompte((m) => ({ ...m, [user]: id || null }))
      toast(id ? 'Niche assignée ✓' : 'Niche retirée — le compte reprend son texte libre')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const enregistreImg = async (cat: string, s: ImgStyleDTO): Promise<void> => {
    try {
      const r = await api.saveImageStyle(cat, s.id ? s : { name: s.name, prompt: s.prompt })
      setImgStylesParCat(r.parCategorie)
      setEditImg(null)
      toast('Style visuel enregistré ✓')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const majDefautImg = async (cat: string, id: string): Promise<void> => {
    try { setImgStylesParCat((await api.setDefaultImageStyle(cat, id)).parCategorie); toast('Style visuel par défaut changé') }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const supprimeImg = async (cat: string, s: ImgStyleDTO): Promise<void> => {
    if (!window.confirm(`Supprimer le style visuel « ${s.name} » ? Les comptes qui l’utilisaient repasseront au style par défaut.`)) return
    try { setImgStylesParCat((await api.deleteImageStyle(cat, s.id)).parCategorie); toast('Style visuel supprimé') }
    catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  /** Génère l'aperçu d'un style visuel. Coûte une image — d'où le message. */
  const genApercuImg = async (cat: string, id: string): Promise<void> => {
    try { await api.genImageStylePreview(cat, id); toast('Aperçu généré ✓') }
    catch (e) { toast('Aperçu impossible : ' + (e as Error).message) }
  }
  /** Style en cours d'édition dans la modale (`null` = fermée). */
  const [editStyle, setEditStyle] = useState<SubStyleDTO | null>(null)
  /** Nouveau style : on part des valeurs du moteur, pas d'un formulaire vide —
   *  un aperçu à blanc n'apprendrait rien. */
  const styleVierge = (): SubStyleDTO => ({
    id: '',
    name: '',
    font: String(globals.subFont ?? 'Archivo Black'),
    size: Number(globals.subSize ?? 86),
    color: String(globals.subColor ?? 'FFFFFF'),
    hilite: String(globals.subHilite ?? 'FFFF00'),
    outline: Number(globals.subOutline ?? 6),
    group: Number(globals.subGroup ?? 3),
    bottom: Number(globals.subBottom ?? 430),
    upper: String(globals.subUpper ?? '1') !== '0'
  })
  /** Les clips n ont pas de bibliotheque propre : creer, promouvoir ou
   *  supprimer depuis un reglage de clip agit sur celle des niches. */
  const catStyle = (c: string): string => (c === 'clip' ? 'niche' : c)
  const enregistreStyle = async (cat: string, s: SubStyleDTO): Promise<void> => {
    try {
      const r = await api.saveSubtitleStyle(catStyle(cat), s.id ? s : { ...s, id: undefined })
      setStylesParCat(r.parCategorie)
      setEditStyle(null)
      toast('Style enregistré ✓')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const majDefaut = async (cat: string, id: string): Promise<void> => {
    try {
      const r = await api.setDefaultSubtitleStyle(catStyle(cat), id)
      setStylesParCat(r.parCategorie)
      toast('Style par défaut changé')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  const supprimeStyle = async (cat: string, s: SubStyleDTO): Promise<void> => {
    if (!window.confirm(`Supprimer le style « ${s.name} » ? Les comptes qui l’utilisaient sur cette catégorie repasseront au style par défaut.`)) return
    try {
      const r = await api.deleteSubtitleStyle(catStyle(cat), s.id)
      setStylesParCat(r.parCategorie)
      toast('Style supprimé')
    } catch (e) { toast('Erreur : ' + (e as Error).message) }
  }
  /** Aperçu des sous-titres, rendu par le serveur. */
  const [apercuSub, setApercuSub] = useState<{ url: string; err: string } | null>(null)
  const [apercuEnCours, setApercuEnCours] = useState(false)
  // L'URL d'objet du PNG précédent doit être révoquée à la main, sinon chaque
  // frappe laisse un blob en mémoire jusqu'au rechargement de la page.
  const urlApercu = useRef('')
  useEffect(() => () => { if (urlApercu.current) URL.revokeObjectURL(urlApercu.current) }, [])

  const charger = useCallback((u: string): void => {
    api.categories(u).then((r) => {
      setCfg(r.settings ?? {})
      setRef(r.settings ?? {})
      setInherited(r.inherited ?? {})
      setParCompte(r.parCompte ?? {})
      setPolices(r.polices ?? [])
      setStylesParCat(r.stylesParCat ?? {})
      setImgStylesParCat(r.imgStylesParCat ?? {})
      setPresetsParCat(r.presetsParCat ?? {})
      setChampsParCat(r.champsParCat ?? {})
      setGlobals((r as unknown as { globals?: CatGlobals }).globals ?? {})
    }).catch(() => undefined)
  }, [])
  // À l'étape de choix, l'appel sans compte ne sert qu'à récupérer `parCompte` :
  // c'est lui qui dit, sur chaque tuile, si le compte dévie ou non.
  useEffect(() => { charger(compte ?? '') }, [compte, charger])
  // Changer de compte remet à l'étape des catégories : rester dans le détail
  // d'une catégorie tout en basculant de compte ferait croire qu'on règle
  // encore le précédent.
  useEffect(() => { setOuvert(null) }, [compte])

  const val = (cat: string, key: string): string => String(cfg[cat]?.[key] ?? '')
  const champ = (cat: string, key: string, v: string): void =>
    setCfg((c) => ({ ...c, [cat]: { ...(c[cat] ?? {}), [key]: v } as Record<string, string | number> }))
  /** Un champ vide = « suivre le global ». On ne compte donc que les non-vides. */
  const nbPerso = (cats: string[]): number =>
    cats.reduce((n, c) => n + Object.values(cfg[c] ?? {}).filter((v) => String(v ?? '') !== '').length, 0)
  /** Même compte, mais sur l'ÉTAT ENREGISTRÉ : une tuile doit décrire ce que le
   *  pilote applique, pas ce qui est en cours de saisie et pas encore validé. */
  const nbEnregistre = (cats: string[]): number =>
    cats.reduce((n, c) => n + Object.values(ref[c] ?? {}).filter((v) => String(v ?? '') !== '').length, 0)
  const modifie = (cats: string[]): boolean =>
    cats.some((c) => JSON.stringify(Object.entries(cfg[c] ?? {}).filter(([, v]) => String(v ?? '') !== '').sort())
      !== JSON.stringify(Object.entries(ref[c] ?? {}).filter(([, v]) => String(v ?? '') !== '').sort()))
  /** Traduction d'une valeur. CAT_MOTS traduit des CODES ('veo', 'fr', '1' =
   *  sous-titres incrustés) : le faire traverser à un nombre donnait
   *  « Candidats = Incrustés ». */
  const mot = (key: string, v: string): string =>
    CAT_NOMBRES.has(key) ? v : CAT_MOTS_CLE[key]?.[v] ?? CAT_MOTS[v] ?? v
  /** Style de sous-titres qu'applique une catégorie : celui qu'elle a choisi,
   *  sinon celui marqué par défaut dans la bibliothèque. */
  const styleDe = (cat: string): SubStyleDTO | null => {
    const lib = libDe(cat)
    const id = val(cat, 'subStyleId')
    return (id ? lib.styles.find((s) => s.id === id) : lib.styles.find((s) => s.id === lib.defaultId)) ?? null
  }
  /** Correspondance clé de catégorie → champ d'un style nommé. */
  const CHAMP_STYLE: Record<string, keyof SubStyleDTO> = {
    subFont: 'font', subSize: 'size', subColor: 'color', subHilite: 'hilite',
    subOutline: 'outline', subGroup: 'group', subBottom: 'bottom', subUpper: 'upper'
  }
  /** Valeur héritée BRUTE (non traduite) et sa provenance. Trois sources
   *  possibles, de la plus proche à la plus lointaine : le style de sous-titres
   *  choisi, la couche tous comptes, les réglages globaux. Nommer la mauvaise
   *  enverrait chercher au mauvais endroit pour la changer. */
  const heriteBrut = (cat: string, key: string): { v: string; src: string } => {
    const champ = CHAMP_STYLE[key]
    if (champ) {
      const s = styleDe(cat)
      if (s) {
        const b = s[champ]
        return { v: typeof b === 'boolean' ? (b ? '1' : '0') : String(b), src: s.name }
      }
    }
    const t = inherited[cat]?.[key]
    if (t != null && String(t) !== '') return { v: String(t), src: 'Tous comptes' }
    const g = globals[key]
    return { v: g == null ? '' : String(g), src: 'Global' }
  }
  const heriteDe = (cat: string, key: string): { txt: string; src: string } => {
    const { v, src } = heriteBrut(cat, key)
    return { txt: v === '' ? 'par défaut' : mot(key, v), src }
  }
  /** Ce qui SERA appliqué : la personnalisation si elle existe, sinon ce dont
   *  elle hérite. Une tuile qui n'annoncerait que les surcharges laisserait
   *  croire que le reste n'est pas réglé. */
  const applique = (cat: string, key: string): { txt: string; perso: boolean } => {
    const v = String(ref[cat]?.[key] ?? '')
    if (v !== '') return { txt: mot(key, v), perso: true }
    return { txt: heriteDe(cat, key).txt, perso: false }
  }

  const enregistrer = async (cats: string[], cle: string): Promise<void> => {
    setBusy(cle)
    try {
      let dernier = cfg
      for (const c of cats) {
        const r = await api.saveCategory(c, (cfg[c] ?? {}) as Record<string, string | number | null>, compte ?? '')
        dernier = r.settings ?? dernier
      }
      setCfg(dernier); setRef(dernier)
      toast('Réglages enregistrés ✓')
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }
  const reinitialiser = async (cats: string[], cle: string): Promise<void> => {
    setBusy(cle)
    try {
      const vide = { engine: '', quality: '', maxScenes: '', lang: '', subtitles: '', speed: '', slides: '', clipCount: '', reframe: '' }
      let dernier = cfg
      for (const c of cats) {
        const r = await api.saveCategory(c, vide, compte ?? '')
        dernier = r.settings ?? {}
      }
      setCfg(dernier); setRef(dernier)
      toast(compte ? 'Catégorie remise sur les réglages tous comptes' : 'Catégorie remise sur les réglages globaux')
    } catch (e) {
      toast('Erreur : ' + (e as Error).message)
    } finally { setBusy('') }
  }

  const select = (cat: string, key: string, label: string, opts: [string, string][]): JSX.Element => {
    const perso = val(cat, key) !== ''
    return (
      <div className={`cat-f${perso ? ' on' : ''}`}>
        <label className="cat-lbl">{label}{perso && <span className="cat-dot" title="Personnalisé pour cette catégorie" />}</label>
        <select className="input-full" value={val(cat, key)} onChange={(e) => champ(cat, key, e.target.value)}>
          {/* L'option « suivre » nomme la SOURCE de la valeur héritée : sur un
              compte, elle peut venir du réglage tous comptes et non des globaux. */}
          <option value="">{heriteDe(cat, key).src} · {heriteDe(cat, key).txt}</option>
          {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    )
  }
  /** Champ libre : un style visuel est une description, pas un choix dans une
   *  liste. Le repère « personnalisé » vaut aussi ici — il montre ce qui dévie du
   *  global sans avoir à lire chaque champ. */
  const texte = (cat: string, key: string, label: string, ph: string): JSX.Element => {
    const perso = val(cat, key) !== ''
    return (
      // `wide` : une description tient mal dans la largeur d'un sélecteur, elle
      // occupe deux colonnes de la grille.
      <div className={`cat-f wide${perso ? ' on' : ''}`}>
        <label className="cat-lbl">{label}{perso && <span className="cat-dot" title="Personnalisé pour cette catégorie" />}</label>
        <textarea className="input-full cat-ta" rows={2} placeholder={ph} value={val(cat, key)} onChange={(e) => champ(cat, key, e.target.value)} />
      </div>
    )
  }
  const nombre = (cat: string, key: string, label: string, min: number, max: number, step?: string): JSX.Element => {
    const perso = val(cat, key) !== ''
    return (
      <div className={`cat-f${perso ? ' on' : ''}`}>
        <label className="cat-lbl">{label}{perso && <span className="cat-dot" title="Personnalisé pour cette catégorie" />}</label>
        <input
          className="input-full" type="number" min={min} max={max} step={step}
          // Le fantôme montre la valeur réellement héritée, couche tous comptes
          // comprise — pas systématiquement le réglage global.
          placeholder={String(inherited[cat]?.[key] ?? globals[key] ?? '')}
          value={val(cat, key)}
          onChange={(e) => champ(cat, key, e.target.value)}
        />
      </div>
    )
  }

  const blocSousTitres = (cat: string, choisi: string, choisir: (id: string) => void): JSX.Element => {
    const lib = libDe(cat)
    return (
      <section className="cat-sec sous-titres">
        <div className="cat-sub">Sous-titres</div>
        <div className="sty-liste">
          {lib.styles.map((s) => {
            const actif = choisi ? s.id === choisi : s.id === lib.defaultId
            return (
              <div key={s.id} className={`card sty-item${actif ? ' actif' : ''}`}>
                {/* La carte entière sélectionne : cliquer sur l'image du style
                    qu'on veut est le geste naturel, pas viser une case. */}
                <button
                  className="sty-choix"
                  title={actif ? 'Style de ce réglage' : 'Choisir pour ce réglage'}
                  onClick={() => choisir(s.id === choisi ? '' : s.id)}
                >
                  <VignetteStyle s={s} />
                  <span className="sty-nom">
                    {s.name}
                    {/* Deux notions distinctes qu'on confond au premier regard :
                        le badge dit ce que suivent LES AUTRES comptes, la coche
                        dit ce qui s'applique ICI. Elles coïncident tant que ce
                        compte n'a rien choisi. */}
                    {s.id === lib.defaultId && (
                      <span className="sty-badge" title="Suivi par tous les comptes qui ne choisissent pas de style">Défaut</span>
                    )}
                    {actif && <span className="sty-coche" title="Style de ce réglage"><Icon name="check" size={13} /></span>}
                  </span>
                  <span className="muted small sty-res">
                    <span className="sty-res-t">
                      {s.font} · {s.size} px · {s.group} mot{s.group > 1 ? 's' : ''} · {s.upper ? 'MAJ' : 'normale'}
                    </span>
                    <span className="sty-pastilles">
                      <i style={{ background: `#${s.color}` }} title={`Texte #${s.color}`} />
                      <i style={{ background: `#${s.hilite}` }} title={`Mot prononcé #${s.hilite}`} />
                    </span>
                  </span>
                </button>
                <div className="sty-actions">
                  {s.id !== lib.defaultId && (
                    <button className="btn xsmall" title="Appliquer à tous les comptes qui n’ont rien choisi" onClick={() => void majDefaut(cat, s.id)}>Défaut</button>
                  )}
                  <button className="btn xsmall" onClick={() => setEditStyle(s)}>Modifier</button>
                  <button className="btn xsmall danger" onClick={() => void supprimeStyle(cat, s)}>Supprimer</button>
                </div>
              </div>
            )
          })}
          {/* Carte d'ajout : elle tient lieu d'état vide, et reste à la même
              place une fois la bibliothèque remplie. */}
          <button className="card sty-ajout" onClick={() => setEditStyle(styleVierge())}>
            <span className="sty-plus">+</span>
            <span>Nouveau style</span>
          </button>
        </div>
      </section>
    )
  }
  /** Bande des réglages nommés. Les paramètres ne sont plus des champs posés sur
   *  le compte mais des fiches réutilisables, comme les styles : on choisit,
   *  on ne ressaisit pas. */
  const blocReglages = (cat: string, note?: string): JSX.Element => {
    const lib = presetLibDe(cat)
    const champs = champsParCat[cat] ?? []
    const choisi = val(cat, 'presetId')
    const libImg = imgLibDe(cat)
    const libSub = libDe(cat)
    /** Résumé d'une fiche : ce qu'elle impose, le reste suivant le global. */
    const resume = (p: PresetDTO): string => {
      const parts = champs
        .filter((k) => String(p[k] ?? '') !== '')
        .map((k) => {
          const d = PARAM_DEF[k]
          const v = String(p[k])
          return `${d.court} ${d.opts ? (d.opts.find(([o]) => o === v)?.[1] ?? v) : v}`
        })
      return parts.length ? parts.join(' · ') : 'Tout suit les réglages globaux'
    }
    /** Les deux styles que la fiche applique — celui qu'elle nomme, sinon celui
     *  par défaut de la bibliothèque. */
    const imgDe = (p: PresetDTO): ImgStyleDTO | undefined =>
      libImg.styles.find((s) => s.id === (String(p.imgStyleId ?? '') || libImg.defaultId))
    const subDe = (p: PresetDTO): SubStyleDTO | undefined =>
      libSub.styles.find((s) => s.id === (String(p.subStyleId ?? '') || libSub.defaultId))
    return (
      <section className="cat-sec sous-titres">
        <div className="cat-sub">Réglages</div>
        <div className="sty-liste">
          {lib.presets.map((p) => {
            const actif = choisi ? p.id === choisi : p.id === lib.defaultId
            const si = imgDe(p)
            const ss = subDe(p)
            return (
              <div key={p.id} className={`card sty-item${actif ? ' actif' : ''}`}>
                <button
                  className="sty-choix"
                  title="Ouvrir ce réglage"
                  onClick={() => setOuvrePreset(p)}
                >
                  {/* Le rendu du style visuel sert de vignette : un réglage se
                      reconnaît d'abord à ce qu'il produit. */}
                  {si && <VignetteImage s={si} cat={cat} onGen={(id) => genApercuImg(cat, id)} />}
                  <span className="sty-nom">
                    {p.name}
                    {p.id === lib.defaultId && <span className="sty-badge" title="Suivi par tous les comptes qui ne choisissent pas de réglage">Défaut</span>}
                    {actif && <span className="sty-coche" title="Appliqué à ce compte"><Icon name="check" size={13} /></span>}
                  </span>
                  <span className="muted small sty-res">
                    <span className="sty-res-t nic-resume">{resume(p)}</span>
                  </span>
                  {(si || ss) && (
                    <span className="muted small sty-res pre-styles">
                      <span className="sty-res-t">
                        {[si?.name, ss?.name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  )}
                </button>
                <div className="sty-actions">
                  {p.id !== lib.defaultId && (
                    <button className="btn xsmall" onClick={() => void majDefautPreset(cat, p.id)}>Défaut</button>
                  )}
                  {!actif && (
                    <button className="btn xsmall" title="Appliquer à ce compte" onClick={() => champ(cat, 'presetId', p.id)}>Appliquer</button>
                  )}
                  <button className="btn xsmall danger" onClick={() => void supprimePreset(cat, p)}>Supprimer</button>
                </div>
              </div>
            )
          })}
          <button className="card sty-ajout" onClick={() => setOuvrePreset({ id: '', name: '' } as PresetDTO)}>
            <span className="sty-plus">+</span>
            <span>Nouveau réglage</span>
          </button>
        </div>
        {note && <div className="muted small cat-note">{note}</div>}
      </section>
    )
  }

  /** Styles visuels : même modèle que les sous-titres. La différence tient à
   *  l'aperçu — il coûte une image, donc il se demande au lieu de s'afficher. */
  const blocStyleVisuel = (cat: string, titre: string, choisi: string, choisir: (id: string) => void): JSX.Element => {
    const lib = imgLibDe(cat)
    return (
      <section className="cat-sec sous-titres">
        <div className="cat-sub">{titre}</div>
        <div className="sty-liste">
          {lib.styles.map((s) => {
            const actif = choisi ? s.id === choisi : s.id === lib.defaultId
            return (
              <div key={s.id} className={`card sty-item${actif ? ' actif' : ''}`}>
                <VignetteImage s={s} cat={cat} onGen={(id) => genApercuImg(cat, id)} />
                <button
                  className="sty-choix"
                  title={actif ? 'Style de ce réglage' : 'Choisir pour ce réglage'}
                  onClick={() => choisir(s.id === choisi ? '' : s.id)}
                >
                  <span className="sty-nom">
                    {s.name}
                    {/* Deux notions distinctes qu'on confond au premier regard :
                        le badge dit ce que suivent LES AUTRES comptes, la coche
                        dit ce qui s'applique ICI. Elles coïncident tant que ce
                        compte n'a rien choisi. */}
                    {s.id === lib.defaultId && (
                      <span className="sty-badge" title="Suivi par tous les comptes qui ne choisissent pas de style">Défaut</span>
                    )}
                    {actif && <span className="sty-coche" title="Style de ce réglage"><Icon name="check" size={13} /></span>}
                  </span>
                  <span className="muted small sty-res">
                    <span className="sty-res-t">{s.prompt}</span>
                  </span>
                </button>
                <div className="sty-actions">
                  {s.id !== lib.defaultId && (
                    <button className="btn xsmall" onClick={() => void majDefautImg(cat, s.id)}>Défaut</button>
                  )}
                  <button className="btn xsmall" onClick={() => setEditImg(s)}>Modifier</button>
                  <button className="btn xsmall danger" onClick={() => void supprimeImg(cat, s)}>Supprimer</button>
                </div>
              </div>
            )
          })}
          <button className="card sty-ajout" onClick={() => setEditImg({ id: '', name: '', prompt: '' })}>
            <span className="sty-plus">+</span>
            <span>Nouveau style</span>
          </button>
        </div>
      </section>
    )
  }

  /** Pied commun : compteur, remise à zéro, enregistrement. */
  const pied = (cats: string[], cle: string): JSX.Element => {
    const n = nbPerso(cats)
    const dirty = modifie(cats)
    return (
      <div className="cat-foot">
        <span className={`cat-count${n ? ' on' : ''}`}>
          {n === 0 ? 'Tout suit les réglages globaux' : `${n} réglage${n > 1 ? 's' : ''} personnalisé${n > 1 ? 's' : ''}`}
        </span>
        {n > 0 && !dirty && (
          <button className="btn ghost-sm" disabled={busy === cle} onClick={() => void reinitialiser(cats, cle)}>Réinitialiser</button>
        )}
        <button className="btn primary" disabled={busy === cle || !dirty} onClick={() => void enregistrer(cats, cle)}>
          {busy === cle ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    )
  }

  type Carte = {
    cle: string; cats: string[]; icone: string; titre: string; teinte: string; hint: string
    /** Ce que la tuile résume, sans avoir à ouvrir. */
    apercu: [string, { txt: string; perso: boolean }][]
    /** Panneaux du détail. Plusieurs quand la catégorie produit des choses de
     *  natures différentes — chacun s'enregistre séparément, régler les diapos
     *  n'a pas à valider les réglages vidéo au passage. */
    panneaux: {
      cle: string; titre?: string; cats: string[]; corps: JSX.Element
      /** Renseignés quand la catégorie en a plusieurs : ils deviennent alors des
       *  tuiles, et une tuile doit dire ce qu'elle contient avant qu'on l'ouvre. */
      icone?: string; hint?: string; apercu?: [string, { txt: string; perso: boolean }][]
    }[]
  }
  const CARTES: Carte[] = [
    {
      cle: 'niche', cats: ['niche', 'carousel'], icone: 'bulb', titre: 'Niches', teinte: 'niche',
      hint: 'Le tout-venant du pilote, sur la niche du compte. Les séries et les sujets imposés suivent ces réglages.',
      // L'aperçu ne montre que ce qui gouverne réellement une vidéo de niche.
      apercu: [
        ['Langue', applique('niche', 'lang')],
        ['Sous-titres', applique('niche', 'subtitles')],
        ['Débit', applique('niche', 'speed')],
        ['Diapos', applique('carousel', 'slides')]
      ],
      // Pas de moteur vidéo ici : une vidéo de niche est faite d'images fixes,
      // sa voix vient du TTS et le moteur ne tourne jamais. Les épisodes de
      // série, eux, lisaient cette catégorie et avaient bien des scènes animées
      // — mais ils ne sont plus produits, et le moteur reste réglable
      // globalement (Réglages → Génération vidéos).
      panneaux: [
        {
          cle: 'v', titre: 'Vidéos', cats: ['niche'], icone: 'clips',
          hint: 'Voix, langue, sous-titres et rendu des images.',
          apercu: [
            ['Langue', applique('niche', 'lang')],
            ['Sous-titres', applique('niche', 'subtitles')],
            ['Style', styleDe('niche')
              ? { txt: styleDe('niche')!.name, perso: val('niche', 'subStyleId') !== '' }
              : { txt: 'aucun', perso: false }]
          ],
          corps: (
            <>
              {blocReglages('niche')}
            </>
          )
        },
        {
          // Les carrousels sont des images : ni voix, ni sous-titres.
          cle: 'c', titre: 'Carrousels', cats: ['carousel'], icone: 'sources',
          hint: 'Suites d’images publiées en diaporama. Ni voix, ni sous-titres.',
          apercu: [
            ['Diapos', applique('carousel', 'slides')],
            ['Style visuel', { txt: val('carousel', 'style') ? 'personnalisé' : 'libre', perso: val('carousel', 'style') !== '' }]
          ],
          corps: (
            <>
              {blocReglages('carousel')}
            </>
          )
        }
      ]
    },
    {
      cle: 'clip', cats: ['clip'], icone: 'scissors', titre: 'Clips (cut streamer)', teinte: 'clip',
      hint: 'Extraits découpés dans un live ou un reportage. Aucune génération : ces vidéos existent déjà.',
      apercu: [
        ['Candidats', applique('clip', 'clipCount')],
        ['Cadrage', applique('clip', 'reframe')]
      ],
      panneaux: [{
        cle: 'c', cats: ['clip'],
        corps: (
          <>
            {blocReglages('clip')}
            <section className="cat-sec">
              <div className="muted small cat-note">
                Le pilote n’en publie qu’un — les autres restent en stock, prêts pour les créneaux « clip en stock ».
              </div>
            </section>
          </>
        )
      }]
    },
    {
      cle: 'genai', cats: ['genai'], icone: 'sparkles', titre: 'Génération IA', teinte: 'genai',
      hint: 'Les vidéos lancées à la main. Les sélecteurs de la carte d’idée restent prioritaires sur ces valeurs.',
      apercu: [
        ['Langue', applique('genai', 'lang')],
        ['Sous-titres', applique('genai', 'subtitles')],
        ['Débit', applique('genai', 'speed')]
      ],
      panneaux: [{
        cle: 'v', cats: ['genai'],
        corps: (
          <>
            {blocReglages('genai', 'Moteur, qualité imposée et scènes max n’agissent que sur les vidéos reproduites depuis une source — seules à avoir des scènes animées.')}
          </>
        )
      }]
    }
  ]

  const carte = CARTES.find((c) => c.cle === ouvert) ?? null

  const profilCourant = profiles.find((p) => p.username === compte)
  const nomCompte = profilCourant?.handle ? `@${profilCourant.handle}` : (compte ?? '')

  // ── Étape 1 : à quel compte ces réglages s'appliquent-ils ? ───────────────
  if (compte === null) {
    return (
      <>
        <div className="page-head"><div><h1>Catégories</h1></div></div>
        {/* `comptes` : chaque tuile prend la hauteur de son contenu. */}
        <div className="cat-grid comptes">
          {profiles.map((p) => {
            const n = parCompte[p.username] ?? 0
            return (
              <button
                className="card cat-card cat-tile cat-acc"
                key={p.username}
                style={{ '--cat': 'var(--cat-niche)' } as CSSProperties}
                onClick={() => setCompte(p.username)}
              >
                <div className="cat-head">
                  <span className="cat-ico"><Icon name="bolt" size={16} /></span>
                  {/* Pas de sous-titre : la même phrase répétée cinq fois est du
                      bruit, et la ligne d'état dit déjà ce qu'il faut savoir. */}
                  <div className="cat-title">{p.handle ? `@${p.handle}` : p.username}</div>
                </div>
                <div className="cat-tile-foot">
                  <span className={`cat-count${n ? ' on' : ''}`}>
                    {n === 0 ? 'Suit les réglages globaux' : `${n} réglage${n > 1 ? 's' : ''} propre${n > 1 ? 's' : ''}`}
                  </span>
                  <span className="cat-go">
                    Ouvrir
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </span>
                </div>
              </button>
            )
          })}
        </div>

      </>
    )
  }

  /** Fil d'Ariane. Trois niveaux : sans lui, deux écrans de tuiles se
   *  ressemblent trop pour qu'on sache où l'on est. */
  const fil = (...feuilles: string[]): JSX.Element => {
    // Chaque niveau sauf le dernier est cliquable, et remonte EXACTEMENT à lui :
    // un fil dont seul le premier maillon fonctionne ne sert à rien.
    const retours = [
      () => { setOuvert(null); setOuvertPan(null); setOuvrePreset(null) },
      () => { setOuvertPan(null); setOuvrePreset(null) },
      () => setOuvrePreset(null)
    ]
    return (
      <div className="cat-fil">
        <button onClick={() => setCompte(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Comptes
        </button>
        <span className="cat-fil-sep">/</span>
        {feuilles.length
          ? <button onClick={retours[0]}>{nomCompte}</button>
          : <span className="cat-fil-ici">{nomCompte}</span>}
        {feuilles.map((f, i) => (
          <span className="cat-fil-seg" key={f}>
            <span className="cat-fil-sep">/</span>
            {i === feuilles.length - 1
              ? <span className="cat-fil-ici">{f}</span>
              : <button onClick={retours[i + 1]}>{f}</button>}
          </span>
        ))}
      </div>
    )
  }

  // ── Détail d'une catégorie ────────────────────────────────────────────────
  if (carte) {
    // Une catégorie à panneau unique n'a rien à faire choisir : on va droit au
    // formulaire. Ce sont les niches, qui produisent deux choses, qui gagnent
    // une étape de plus.
    const pan = carte.panneaux.length === 1
      ? carte.panneaux[0]
      : carte.panneaux.find((p) => p.cle === ouvertPan) ?? null

    // Les styles VISUELS appartiennent au panneau ouvert : sur les niches, la
    // bibliothèque des vidéos n'est pas celle des carrousels.
    const catImg = ouvertPan === 'c' ? 'carousel' : carte.cle
    const modale = (
      <>
        {editStyle && (
          <ModaleStyle
            style={editStyle}
            polices={polices}
            onFerme={() => setEditStyle(null)}
            onEnregistre={(s) => enregistreStyle(carte.cle, s)}
          />
        )}
        {editImg && (
          <ModaleImgStyle
            style={editImg}
            onFerme={() => setEditImg(null)}
            onEnregistre={(s) => enregistreImg(catImg, s)}
          />
        )}
              </>
    )

    // ── Choix du panneau ────────────────────────────────────────────────────
    if (!pan) {
      return (
        <div className="cat-detail" style={{ '--cat': `var(--cat-${carte.teinte})` } as CSSProperties}>
          {fil(carte.titre)}
          <div className="cat-dhead">
            <span className="cat-ico lg"><Icon name={carte.icone} size={21} /></span>
            <div>
              <h1>{carte.titre}</h1>
            </div>
          </div>
          {/* Le SUJET du compte. Il vaut pour ses vidéos comme pour ses
              carrousels, sa place est donc ici et non dans l'un des panneaux. */}
          {compte && (
            <section className="cat-sec sous-titres nic-bande">
              <div className="cat-sub">Niche du compte</div>
              <div className="sty-liste">
                {nichesLib.map((n) => {
                  const actif = nicheParCompte[compte] === n.id
                  return (
                    <div key={n.id} className={`card sty-item${actif ? ' actif' : ''}`}>
                      <button
                        className="sty-choix"
                        title={actif ? 'Niche de ce compte' : 'Assigner à ce compte'}
                        onClick={() => void assigner(compte, actif ? '' : n.id)}
                      >
                        <span className="sty-nom">
                          {n.name}
                          {actif && <span className="sty-coche" title="Niche de ce compte"><Icon name="check" size={13} /></span>}
                        </span>
                        <span className="muted small sty-res">
                          <span className="sty-res-t nic-resume">{n.brief || 'Aucun brief — l’IA n’aura que le nom.'}</span>
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
          <div className="cat-grid">
            {carte.panneaux.map((p) => {
              const n = nbEnregistre(p.cats)
              const dirty = modifie(p.cats)
              return (
                <button
                  className="card cat-card cat-tile"
                  key={p.cle}
                  style={{ '--cat': `var(--cat-${carte.teinte})` } as CSSProperties}
                  onClick={() => setOuvertPan(p.cle)}
                >
                  <div className="cat-head">
                    <span className="cat-ico"><Icon name={p.icone ?? 'clips'} size={16} /></span>
                    <div>
                      <div className="cat-title">{p.titre}</div>
                      <div className="muted small cat-hint">{p.hint}</div>
                    </div>
                  </div>
                  <div className="cat-apercu">
                    {(p.apercu ?? []).map(([lbl, v]) => (
                      <div className={`cat-ap${v.perso ? ' on' : ''}`} key={lbl}>
                        <span className="cat-ap-l">{lbl}</span>
                        <span className="cat-ap-v">{v.txt}</span>
                      </div>
                    ))}
                  </div>
                  <div className="cat-tile-foot">
                    <span className={`cat-count${n ? ' on' : ''}`}>
                      {dirty
                        ? 'Modifications non enregistrées'
                        : n === 0 ? 'Tout suit les réglages globaux' : `${n} réglage${n > 1 ? 's' : ''} personnalisé${n > 1 ? 's' : ''}`}
                    </span>
                    <span className="cat-go">
                      Personnaliser
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

        </div>
      )
    }

    const multi = carte.panneaux.length > 1
    const catP = ouvertPan === 'c' ? 'carousel' : carte.cle

    // ── Page d'UN réglage : ses paramètres et les deux styles qu'il compose ──
    if (ouvrePreset) {
      const d = ouvrePreset
      const majD = (k: string, v: string): void => setOuvrePreset((o) => (o ? { ...o, [k]: v } : o))
      const champsP = champsParCat[catP] ?? []
      return (
        <div className="cat-detail" style={{ '--cat': `var(--cat-${carte.teinte})` } as CSSProperties}>
          {fil(carte.titre, ...(multi ? [pan.titre ?? ''] : []), d.name.trim() || 'Nouveau réglage')}
          <div className="cat-dhead">
            <span className="cat-ico lg"><Icon name="settings" size={21} /></span>
            <div><h1>{d.name.trim() || 'Nouveau réglage'}</h1></div>
          </div>
          <div className="card cat-panel">
            <div className="cat-body">
              <section className="cat-sec">
                <div className="cat-f">
                  <label className="cat-lbl">Nom du réglage</label>
                  <input className="input-full" value={d.name} placeholder="ex. Français standard" onChange={(e) => majD('name', e.target.value)} />
                </div>
                {champsP.map((k) => {
                  const def = PARAM_DEF[k]
                  if (!def) return null
                  const g = globals[k]
                  const h = g == null || g === '' ? 'par défaut' : mot(k, String(g))
                  const v = String(d[k] ?? '')
                  return (
                    <div className={`cat-f${v !== '' ? ' on' : ''}`} key={k}>
                      <label className="cat-lbl">{def.label}</label>
                      {def.opts
                        ? (
                          <select className="input-full" value={v} onChange={(e) => majD(k, e.target.value)}>
                            <option value="">Global · {h}</option>
                            {def.opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
                          </select>
                        )
                        : <input className="input-full" type="number" min={def.min} max={def.max} step={def.pas} placeholder={h} value={v} onChange={(e) => majD(k, e.target.value)} />}
                    </div>
                  )
                })}
              </section>
              {/* Les bibliothèques disponibles : on compose le réglage en
                  cliquant, et on peut y créer un style sans quitter la page.
                  Un clip n'engendre aucune image, une reproduction doit garder
                  celui de sa source — ni l'un ni l'autre n'a de style visuel. */}
              {(catP === 'niche' || catP === 'carousel') &&
                blocStyleVisuel(catP, catP === 'carousel' ? 'Style visuel des diapos' : 'Style visuel des images',
                  String(d.imgStyleId ?? ''), (id) => majD('imgStyleId', id))}
              {catP !== 'carousel' &&
                blocSousTitres(catP, String(d.subStyleId ?? ''), (id) => majD('subStyleId', id))}
            </div>
            <div className="cat-foot">
              <span className="cat-count">Un champ laissé vide suit le réglage global.</span>
              <button className="btn ghost-sm" onClick={() => setOuvrePreset(null)}>Annuler</button>
              <button
                className="btn primary"
                disabled={!d.name.trim()}
                onClick={() => void enregistrePreset(catP, d).then(() => setOuvrePreset(null))}
              >
                Enregistrer
              </button>
            </div>
          </div>
          {modale}
        </div>
      )
    }

    // ── Formulaire d'un panneau ─────────────────────────────────────────────
    const dirty = modifie(pan.cats)
    return (
      <div className="cat-detail" style={{ '--cat': `var(--cat-${carte.teinte})` } as CSSProperties}>
        {multi ? fil(carte.titre, pan.titre ?? '') : fil(carte.titre)}
        <div className="cat-dhead">
          <span className="cat-ico lg"><Icon name={multi ? (pan.icone ?? carte.icone) : carte.icone} size={21} /></span>
          <div>
            <h1>{multi ? `${carte.titre} · ${pan.titre}` : carte.titre}</h1>
          </div>
          {/* Le repère de saisie en cours vit dans l'en-tête, pas seulement à
              côté du bouton : sur un formulaire haut, le pied peut être sorti
              de l'écran au moment où l'on modifie un champ. */}
          {dirty && <span className="cat-dirty">Modifications non enregistrées</span>}
        </div>
        <div className="card cat-panel">
          <div className="cat-body">{pan.corps}</div>
          {pied(pan.cats, `${carte.cle}:${pan.cle}`)}
        </div>
        {modale}
      </div>
    )
  }

  // ── Grille de choix ───────────────────────────────────────────────────────
  return (
    <>
      {fil()}
      {/* Sans sous-titre : les tuiles disent déjà ce que fait chaque catégorie
          et ce qu'elle applique. */}
      <div className="page-head">
        <div><h1>{nomCompte}</h1></div>
      </div>
      <div className="cat-grid">
        {/* La teinte de la catégorie passe par une variable locale `--cat` : la
            CSS s'en sert pour le filet, l'icône et le repère de personnalisation,
            sans qu'aucune couleur ne soit écrite en dur dans le rendu. */}
        {CARTES.map((c) => {
          const n = nbEnregistre(c.cats)
          const dirty = modifie(c.cats)
          return (
            <button
              className="card cat-card cat-tile"
              key={c.cle}
              style={{ '--cat': `var(--cat-${c.teinte})` } as CSSProperties}
              onClick={() => setOuvert(c.cle)}
            >
              <div className="cat-head">
                <span className="cat-ico"><Icon name={c.icone} size={16} /></span>
                <div>
                  <div className="cat-title">{c.titre}</div>
                  <div className="muted small cat-hint">{c.hint}</div>
                </div>
              </div>
              <div className="cat-apercu">
                {c.apercu.map(([lbl, v]) => (
                  <div className={`cat-ap${v.perso ? ' on' : ''}`} key={lbl}>
                    <span className="cat-ap-l">{lbl}</span>
                    <span className="cat-ap-v">{v.txt}</span>
                  </div>
                ))}
              </div>
              <div className="cat-tile-foot">
                <span className={`cat-count${n ? ' on' : ''}`}>
                  {dirty
                    ? 'Modifications non enregistrées'
                    : n === 0
                      ? 'Tout suit les réglages globaux'
                      : `${n} réglage${n > 1 ? 's' : ''} personnalisé${n > 1 ? 's' : ''}`}
                </span>
                <span className="cat-go">
                  Personnaliser
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

const SET_TABS: { id: string; label: string }[] = [
  { id: 'ia', label: 'IA (Claude)' },
  { id: 'download', label: 'Téléchargement' },
  { id: 'genai', label: 'Génération vidéos' },
  { id: 'links', label: 'Liens courts' },
  { id: 'transcribe', label: 'Transcription & recadrage' },
  { id: 'publish', label: 'Publication' }
]
function Settings({ toast, onTtProfile }: { toast: (m: string) => void; onTtProfile: (p: { nickname: string | null; avatarUrl: string | null }) => void }): JSX.Element {
  const [tab, setTab] = useState('ia')
  const [flags, setFlags] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<{ has: boolean; masked: string | null }>({ has: false, masked: null })
  const [groqKey, setGroqKey] = useState('')
  const [groqHas, setGroqHas] = useState(false)
  const [rapidKey, setRapidKey] = useState('')
  const [rapidHas, setRapidHas] = useState(false)
  const [cookiesHas, setCookiesHas] = useState(false)
  const [upKey, setUpKey] = useState('')
  const [upHas, setUpHas] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiHas, setOpenaiHas] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiHas, setGeminiHas] = useState(false)
  const [falKey, setFalKey] = useState('')
  const [falHas, setFalHas] = useState(false)
  const [diKey, setDiKey] = useState('')
  const [diHas, setDiHas] = useState(false)
  const [elevenKey, setElevenKey] = useState('')
  const [elevenHas, setElevenHas] = useState(false)
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
    ;['publish_mode', 'highlights_model', 'script_model', 'transcribe_enabled', 'transcribe_backend', 'reframe_focus', 'tiktok_privacy', 'tiktok_client_key', 'tiktok_redirect', 'uploadpost_user', 'uploadpost_users', 'uploadpost_fallback', 'voice_provider'].forEach((k) => loadFlag(k).catch(() => undefined))
    api.apiKeyStatus().then(setKeyStatus).catch(() => undefined)
    api.groqStatus().then((r) => setGroqHas(r.has)).catch(() => undefined)
    api.rapidApiStatus().then((r) => setRapidHas(r.has)).catch(() => undefined)
    api.cookiesStatus().then((r) => setCookiesHas(r.has)).catch(() => undefined)
    api.uploadPostStatus().then((r) => setUpHas(r.has)).catch(() => undefined)
    api.openaiStatus().then((r) => setOpenaiHas(r.has)).catch(() => undefined)
    api.geminiStatus().then((r) => setGeminiHas(r.has)).catch(() => undefined)
    api.falStatus().then((r) => setFalHas(r.has)).catch(() => undefined)
    api.deepinfraStatus().then((r) => setDiHas(r.has)).catch(() => undefined)
    api.elevenlabsStatus().then((r) => setElevenHas(r.has)).catch(() => undefined)
    api.musicList().then((r) => setMusic(r.tracks)).catch(() => undefined)
    api.golinks().then((r) => setLinks(Object.entries(r.links).map(([slug, url]) => ({ slug, url })))).catch(() => undefined)
    api.tiktokStatus().then(setTt).catch(() => undefined)
  }, [loadFlag])

  const setFlag = async (k: string, v: string): Promise<void> => {
    setFlags((f) => ({ ...f, [k]: v }))
    await api.setFlag(k, v)
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
      <div className="page-head"><div><h1>Réglages</h1></div></div>

      <div className="set-tabs">
        {SET_TABS.map((t) => (
          <button key={t.id} className={`set-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'ia' && (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>IA (Claude)</h3>
        {/* Deux chemins vers les MÊMES modèles, au même tarif. DeepInfra revend
            l'accès derrière un point d'entrée Anthropic-compatible : utile quand
            un seul des deux comptes est approvisionné. */}
        <Field label="Par où passent les appels Claude">
          <select value={flags.claude_provider || 'anthropic'} onChange={(e) => setFlag('claude_provider', e.target.value)}>
            <option value="anthropic">Anthropic — compte direct</option>
            <option value="deepinfra">DeepInfra — même tarif, débité du compte DeepInfra</option>
          </select>
        </Field>
        <Field label={
          (flags.claude_provider === 'deepinfra')
            ? 'Clé Anthropic (inutilisée tant que les appels passent par DeepInfra)'
            : keyStatus.has ? `Clé configurée ✓ (${keyStatus.masked})` : 'Clé API Anthropic'
        }>
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
      )}

      {tab === 'download' && (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Téléchargement des vidéos (clips YouTube)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Sur le serveur, YouTube exige une session connectée pour télécharger
          (« Sign in to confirm you're not a bot »). La méthode fiable : importer tes
          <b> cookies YouTube</b>. Le PO token est déjà en place côté serveur ; les cookies complètent le dispositif.
        </p>
        <Field label={cookiesHas ? 'Cookies YouTube configurés ✓' : 'Cookies YouTube (recommandé)'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="btn primary" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={15} /> {cookiesHas ? 'Remplacer le fichier' : 'Importer cookies.txt'}
                <input type="file" accept=".txt,text/plain" style={{ display: 'none' }} onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  try { await api.uploadCookies(f); setCookiesHas((await api.cookiesStatus()).has); toast('Cookies YouTube enregistrés ✅') }
                  catch (err) { toast(`Erreur : ${String((err as Error).message)}`) }
                  e.target.value = ''
                }} />
              </label>
              {cookiesHas && (
                <button className="btn" onClick={async () => {
                  try { await api.deleteCookies(); setCookiesHas(false); toast('Cookies supprimés') }
                  catch (err) { toast(`Erreur : ${String((err as Error).message)}`) }
                }}>Supprimer</button>
              )}
            </div>
            <div className="muted small">
              Exporte les cookies avec l'extension « Get cookies.txt LOCALLY » depuis une page
              <b> youtube.com</b> connectée (un compte Google <b>jetable</b> de préférence), puis importe le fichier ici.
              À refaire si les téléchargements se remettent à échouer (cookies expirés).
            </div>
          </div>
        </Field>
        <Field label={rapidHas ? 'Clé RapidAPI configurée ✓ (recherche + repli)' : 'Clé RapidAPI (recherche de clips)'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="x-rapidapi-key…" value={rapidKey} onChange={(e) => setRapidKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setRapidApiKey(rapidKey); setRapidKey(''); setRapidHas((await api.rapidApiStatus()).has); toast('Clé RapidAPI enregistrée') }} disabled={!rapidKey.trim()}>Enregistrer</button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Sert à la recherche et au choix automatique des vidéos à cliper. Son téléchargement direct est souvent bloqué par YouTube (403) — privilégie les cookies ci-dessus.</div>
        </Field>
      </div>
      )}

      {tab === 'genai' && (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Génération de vidéos (IA)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Sert à produire les vidéos verticales du pilote auto : voix off + images IA + sous-titres.
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
        <Field label={diHas ? 'Clé DeepInfra configurée ✓' : 'Clé DeepInfra (hub média : Veo, images, animation, transcription)'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-full" style={{ flex: 1 }} type="password" placeholder="clé DeepInfra…  (deepinfra.com → Dashboard → API Keys)" value={diKey} onChange={(e) => setDiKey(e.target.value)} />
            <button className="btn primary" onClick={async () => { await api.setDeepinfraKey(diKey); setDiKey(''); setDiHas((await api.deepinfraStatus()).has); toast('Clé DeepInfra enregistrée') }} disabled={!diKey.trim()}>Enregistrer</button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Fournisseur principal pour les images (Seedream), l’animation des scènes (Pixverse) et la transcription (Whisper) — les anciens (OpenAI, Gemini, fal.ai, Groq) servent de repli automatique. Les scènes parlées passent d’abord par le quota Veo GRATUIT de Google, puis par DeepInfra (même modèle, ~1,20 $/scène) au lieu de perdre voix et synchro labiale.</div>
        </Field>
        <Field label="Voix off des vidéos (narration)">
          <select className="input-full" style={{ maxWidth: 320 }} value={flags['voice_provider'] || 'openai'} onChange={(e) => void setFlag('voice_provider', e.target.value)}>
            <option value="openai">OpenAI (TTS — inclus)</option>
            <option value="elevenlabs">ElevenLabs (voix humaines){elevenHas ? '' : ' — clé requise'}</option>
          </select>
          {(flags['voice_provider'] || 'openai') === 'elevenlabs' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="input-full" style={{ flex: 1 }} type="password" placeholder={elevenHas ? 'Clé ElevenLabs configurée ✓ — recolle pour changer' : 'clé ElevenLabs…  (elevenlabs.io → Profile → API key)'} value={elevenKey} onChange={(e) => setElevenKey(e.target.value)} />
              <button className="btn primary" onClick={async () => { await api.setElevenlabsKey(elevenKey); setElevenKey(''); setElevenHas((await api.elevenlabsStatus()).has); toast('Clé ElevenLabs enregistrée') }} disabled={!elevenKey.trim()}>Enregistrer</button>
            </div>
          )}
          <div className="muted small" style={{ marginTop: 6 }}>ElevenLabs = voix nettement plus humaines/organiques (modèle multilingue). Payant (~5 $/mois). Choisis ensuite la voix <b>par compte</b> (⚙️ d'une ligne → onglet Vidéos de niche → bouton Écouter). Les épisodes de <b>série</b> gardent Veo (voix native jouée).</div>
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
      )}

      {tab === 'links' && (
      <div className="card">
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
      )}

      {tab === 'transcribe' && (
      <div className="card">
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
      )}

      {tab === 'publish' && (
      <div className="card">
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
      )}

    </>
  )
}
