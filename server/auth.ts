import { createHmac, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { config } from './config'

// Auth mono-utilisateur sans dépendance externe : un cookie de session signé
// (HMAC-SHA256 sur SECRET_KEY). Pas de base d'utilisateurs : un seul mot de passe.

const COOKIE = 'ttc_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 jours

function sign(payload: string): string {
  const mac = createHmac('sha256', config.secretKey).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

function verify(token: string): boolean {
  const i = token.lastIndexOf('.')
  if (i < 0) return false
  const payload = token.slice(0, i)
  const expected = sign(payload)
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  if (!timingSafeEqual(a, b)) return false
  const exp = Number(payload.split('|')[1])
  return Number.isFinite(exp) && Date.now() < exp
}

function passwordOk(input: string): boolean {
  const a = Buffer.from(String(input))
  const b = Buffer.from(config.adminPassword)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** POST /api/login { password } → pose le cookie de session. */
export function handleLogin(req: Request, res: Response): void {
  const password = (req.body && req.body.password) || ''
  if (!passwordOk(password)) {
    res.status(401).json({ error: 'Mot de passe incorrect' })
    return
  }
  const token = sign(`session|${Date.now() + MAX_AGE_MS}`)
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS
  })
  res.json({ ok: true })
}

export function handleLogout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE)
  res.json({ ok: true })
}

export function isAuthed(req: Request): boolean {
  const token = req.cookies?.[COOKIE]
  return typeof token === 'string' && verify(token)
}

/** Middleware : protège les routes (API + médias). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next()
  res.status(401).json({ error: 'Non authentifié' })
}
