import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { join } from 'path'
import * as schema from './schema'

let _sqlite: Database.Database | null = null
let _db: BetterSQLite3Database<typeof schema> | null = null

export function initDb(dataDir: string): BetterSQLite3Database<typeof schema> {
  if (_db) return _db
  const file = join(dataDir, 'tiktokclip.db')
  _sqlite = new Database(file)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.exec(schema.SCHEMA_DDL)
  // Migration légère pour les bases existantes : ajoute les colonnes manquantes
  // (CREATE TABLE IF NOT EXISTS ne modifie pas une table déjà présente).
  const clipCols = _sqlite.prepare('PRAGMA table_info(clips)').all() as { name: string }[]
  if (!clipCols.some((c) => c.name === 'published_account')) {
    _sqlite.exec('ALTER TABLE clips ADD COLUMN published_account TEXT')
  }
  if (!clipCols.some((c) => c.name === 'profile')) {
    _sqlite.exec('ALTER TABLE clips ADD COLUMN profile TEXT')
  }
  if (!clipCols.some((c) => c.name === 'post_url')) {
    _sqlite.exec('ALTER TABLE clips ADD COLUMN post_url TEXT')
  }
  if (!clipCols.some((c) => c.name === 'post_id')) {
    _sqlite.exec('ALTER TABLE clips ADD COLUMN post_id TEXT')
  }
  // Au démarrage, aucune source n'est réellement en cours : on débloque celles
  // restées en "running" suite à une fermeture/redémarrage de l'app.
  _sqlite.exec("UPDATE sources SET status = 'pending' WHERE status IN ('running', 'queued')")
  // De même, un clip resté en "scheduled" est un orphelin d'une publication
  // interrompue (redéploiement) : on le repasse en "failed" pour qu'il soit repris.
  _sqlite.exec("UPDATE clips SET publish_status = 'failed' WHERE publish_status = 'scheduled'")
  _db = drizzle(_sqlite, { schema })
  return _db
}

export function db(): BetterSQLite3Database<typeof schema> {
  if (!_db) throw new Error('DB non initialisée — appelle initDb() au démarrage du main process.')
  return _db
}

export function closeDb(): void {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
