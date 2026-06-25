import { safeStorage } from 'electron'
import { getSetting, setSetting, deleteSetting } from './db/repo'

const KEY_ENC = 'anthropic_key_enc' // chiffré (base64) si safeStorage dispo
const KEY_PLAIN = 'anthropic_key_plain' // repli si chiffrement indisponible

/** Stocke la clé API Anthropic, chiffrée via safeStorage quand c'est possible. */
export function setApiKey(value: string): void {
  const v = value.trim()
  if (!v) {
    clearApiKey()
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    setSetting(KEY_ENC, safeStorage.encryptString(v).toString('base64'))
    deleteSetting(KEY_PLAIN)
  } else {
    setSetting(KEY_PLAIN, v)
    deleteSetting(KEY_ENC)
  }
}

export function getApiKey(): string | null {
  const enc = getSetting(KEY_ENC)
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }
  return getSetting(KEY_PLAIN)
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

/** Version masquée de la clé pour l'affichage (jamais la clé complète). */
export function getApiKeyMasked(): string | null {
  const k = getApiKey()
  if (!k) return null
  if (k.length <= 12) return '…'
  return `${k.slice(0, 7)}…${k.slice(-4)}`
}

export function clearApiKey(): void {
  deleteSetting(KEY_ENC)
  deleteSetting(KEY_PLAIN)
}

// ───────────── Secrets génériques chiffrés (TikTok, etc.) ─────────────

export function setEncrypted(name: string, value: string): void {
  const v = value.trim()
  if (!v) {
    deleteSetting(`${name}_enc`)
    deleteSetting(`${name}_plain`)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    setSetting(`${name}_enc`, safeStorage.encryptString(v).toString('base64'))
    deleteSetting(`${name}_plain`)
  } else {
    setSetting(`${name}_plain`, v)
    deleteSetting(`${name}_enc`)
  }
}

export function getEncrypted(name: string): string | null {
  const enc = getSetting(`${name}_enc`)
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }
  return getSetting(`${name}_plain`)
}

export function clearEncrypted(name: string): void {
  deleteSetting(`${name}_enc`)
  deleteSetting(`${name}_plain`)
}
