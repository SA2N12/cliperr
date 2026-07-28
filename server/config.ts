import { join } from 'path'

export interface AppPaths {
  data: string
  downloads: string
  clips: string
  bin: string
  models: string
  uploads: string
  /** Fichiers exposés PUBLIQUEMENT et temporairement (nom aléatoire) : certains
   *  modèles (p-video) exigent une URL et refusent le base64. */
  pub: string
}

/** Dossiers de travail, ancrés dans DATA_DIR (volume persistant du conteneur). */
export function appPaths(): AppPaths {
  const root = process.env.DATA_DIR || join(process.cwd(), 'data')
  return {
    data: root,
    downloads: join(root, 'downloads'),
    clips: join(root, 'clips'),
    bin: join(root, 'bin'),
    models: join(root, 'models'),
    uploads: join(root, 'uploads'),
    pub: join(root, 'pub')
  }
}

export const config = {
  port: Number(process.env.PORT || 8080),
  /** Mot de passe d'accès au dashboard (login mono-utilisateur). */
  adminPassword: process.env.ADMIN_PASSWORD || '',
  /** Clé maîtresse : signe les sessions + chiffre les secrets. OBLIGATOIRE en prod. */
  secretKey: process.env.SECRET_KEY || '',
  /** URL publique du provider PO token (conteneur bgutil). */
  potProviderUrl: process.env.BGUTIL_URL || 'http://bgutil-provider:4416',
  /** Origine publique du dashboard — nécessaire pour donner une URL atteignable
   *  aux modèles qui vont chercher les fichiers eux-mêmes (p-video). */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, '')
}

export function assertConfig(): void {
  if (!config.secretKey || config.secretKey.length < 16) {
    throw new Error('SECRET_KEY manquant ou trop court (≥16 caractères requis).')
  }
  if (!config.adminPassword) {
    throw new Error('ADMIN_PASSWORD manquant (mot de passe du dashboard).')
  }
}
