import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull(),
  title: text('title'),
  author: text('author'),
  durationSec: real('duration_sec'),
  filePath: text('file_path'),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  createdAt: integer('created_at').notNull()
})

export const clips = sqliteTable('clips', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  score: real('score'),
  reason: text('reason'),
  filePath: text('file_path'),
  title: text('title'),
  description: text('description'),
  hashtags: text('hashtags'),
  reviewStatus: text('review_status').notNull().default('pending'),
  publishStatus: text('publish_status').notNull().default('unpublished'),
  publishedAccount: text('published_account'),
  profile: text('profile'),
  postUrl: text('post_url'),
  postId: text('post_id'),
  createdAt: integer('created_at').notNull()
})

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id'),
  clipId: integer('clip_id'),
  stage: text('stage').notNull(),
  status: text('status').notNull().default('pending'),
  progress: real('progress').notNull().default(0),
  error: text('error'),
  updatedAt: integer('updated_at').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const ideas = sqliteTable('ideas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  niche: text('niche').notNull(),
  title: text('title'),
  data: text('data').notNull(),
  createdAt: integer('created_at').notNull()
})

export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cron: text('cron').notNull(),
  enabled: integer('enabled').notNull().default(1),
  lastRunAt: integer('last_run_at'),
  createdAt: integer('created_at').notNull()
})

// SQL idempotent exécuté au démarrage. On ne dépend pas de fichiers de
// migration drizzle-kit pour l'instant : ce DDL crée les tables si absentes.
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  title TEXT,
  author TEXT,
  duration_sec REAL,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  score REAL,
  reason TEXT,
  file_path TEXT,
  title TEXT,
  description TEXT,
  hashtags TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  publish_status TEXT NOT NULL DEFAULT 'unpublished',
  published_account TEXT,
  profile TEXT,
  post_url TEXT,
  post_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  clip_id INTEGER,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  niche TEXT NOT NULL,
  title TEXT,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_source ON clips(source_id);
`
