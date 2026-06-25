import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { getSetting, setSetting, deleteSetting } from '../src/main/db/repo'
import { config } from './config'

// Remplace `safeStorage` d'Electron : chiffrement AES-256-GCM avec une clé
// dérivée de SECRET_KEY. Les valeurs chiffrées sont stockées dans la table
// `settings` (préfixe `_enc`). Format stocké : base64(iv | tag | ciphertext).

let _key: Buffer | null = null
function key(): Buffer {
  if (!_key) _key = scryptSync(config.secretKey, 'tiktokclip-secrets', 32)
  return _key
}

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decrypt(stored: string): string | null {
  try {
    const buf = Buffer.from(stored, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ── Secrets génériques (TikTok client secret, tokens, clé Groq…) ──
export function setEncrypted(name: string, value: string): void {
  const v = value.trim()
  if (!v) {
    deleteSetting(`${name}_enc`)
    return
  }
  setSetting(`${name}_enc`, encrypt(v))
}

export function getEncrypted(name: string): string | null {
  const enc = getSetting(`${name}_enc`)
  return enc ? decrypt(enc) : null
}

export function clearEncrypted(name: string): void {
  deleteSetting(`${name}_enc`)
}

// ── Clé API Anthropic ──
const ANTHROPIC = 'anthropic_key'

export function setApiKey(value: string): void {
  setEncrypted(ANTHROPIC, value)
}

export function getApiKey(): string | null {
  return getEncrypted(ANTHROPIC)
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

export function getApiKeyMasked(): string | null {
  const k = getApiKey()
  if (!k) return null
  if (k.length <= 12) return '…'
  return `${k.slice(0, 7)}…${k.slice(-4)}`
}

export function clearApiKey(): void {
  clearEncrypted(ANTHROPIC)
}
