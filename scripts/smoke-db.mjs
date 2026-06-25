// Valide que better-sqlite3 (ABI Electron) se charge et que drizzle fait du CRUD.
// À exécuter avec le binaire Electron en mode Node (ELECTRON_RUN_AS_NODE=1).
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { eq } from 'drizzle-orm'

const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull()
})

const sqlite = new Database(':memory:')
sqlite.exec(`CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);`)
const db = drizzle(sqlite, { schema: { sources } })

const inserted = db
  .insert(sources)
  .values({ url: 'https://example.com/vod', status: 'pending', createdAt: Date.now() })
  .returning()
  .get()
console.log('insert ->', inserted)

db.update(sources).set({ status: 'done' }).where(eq(sources.id, inserted.id)).run()
const rows = db.select().from(sources).all()
console.log('select ->', rows)

if (rows.length === 1 && rows[0].status === 'done') {
  console.log('\nOK — better-sqlite3 (ABI Electron) + drizzle fonctionnent.')
} else {
  console.error('Résultat inattendu')
  process.exit(1)
}
