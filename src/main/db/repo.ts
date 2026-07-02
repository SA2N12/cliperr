import { eq, desc } from 'drizzle-orm'
import { db } from './client'
import { sources, clips, settings, ideas } from './schema'
import type { SourceDTO, ClipDTO, JobStatus, ViralIdea, SavedIdea } from '../../shared/types'

type SourceRow = typeof sources.$inferSelect
type ClipRow = typeof clips.$inferSelect
type IdeaRow = typeof ideas.$inferSelect

function toSourceDTO(r: SourceRow): SourceDTO {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    author: r.author,
    durationSec: r.durationSec,
    filePath: r.filePath,
    status: r.status as JobStatus,
    error: r.error,
    createdAt: r.createdAt
  }
}

function toClipDTO(r: ClipRow): ClipDTO {
  return {
    id: r.id,
    sourceId: r.sourceId,
    startSec: r.startSec,
    endSec: r.endSec,
    score: r.score,
    reason: r.reason,
    filePath: r.filePath,
    title: r.title,
    description: r.description,
    hashtags: r.hashtags,
    reviewStatus: r.reviewStatus as ClipDTO['reviewStatus'],
    publishStatus: r.publishStatus as ClipDTO['publishStatus'],
    publishedAccount: r.publishedAccount,
    createdAt: r.createdAt
  }
}

export function createSource(url: string): SourceDTO {
  const row = db()
    .insert(sources)
    .values({ url, status: 'pending', createdAt: Date.now() })
    .returning()
    .get()
  return toSourceDTO(row)
}

export function listSources(): SourceDTO[] {
  return db().select().from(sources).orderBy(desc(sources.createdAt)).all().map(toSourceDTO)
}

export function getSource(id: number): SourceDTO | null {
  const row = db().select().from(sources).where(eq(sources.id, id)).get()
  return row ? toSourceDTO(row) : null
}

export function updateSource(id: number, patch: Partial<SourceRow>): void {
  db().update(sources).set(patch).where(eq(sources.id, id)).run()
}

export function listClips(sourceId?: number): ClipDTO[] {
  const q = db().select().from(clips)
  const rows = sourceId == null ? q.all() : q.where(eq(clips.sourceId, sourceId)).all()
  return rows.map(toClipDTO)
}

export function createClip(input: {
  sourceId: number
  startSec: number
  endSec: number
  score?: number | null
  reason?: string | null
  title?: string | null
  description?: string | null
  hashtags?: string | null
  filePath?: string | null
}): ClipDTO {
  const row = db()
    .insert(clips)
    .values({
      sourceId: input.sourceId,
      startSec: input.startSec,
      endSec: input.endSec,
      score: input.score ?? null,
      reason: input.reason ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      hashtags: input.hashtags ?? null,
      filePath: input.filePath ?? null,
      createdAt: Date.now()
    })
    .returning()
    .get()
  return toClipDTO(row)
}

export function updateClip(id: number, patch: Partial<ClipRow>): void {
  db().update(clips).set(patch).where(eq(clips.id, id)).run()
}

export function getClip(id: number): ClipDTO | null {
  const row = db().select().from(clips).where(eq(clips.id, id)).get()
  return row ? toClipDTO(row) : null
}

export function setClipReview(id: number, status: ClipDTO['reviewStatus']): void {
  db().update(clips).set({ reviewStatus: status }).where(eq(clips.id, id)).run()
}

export function setClipPublish(id: number, status: ClipDTO['publishStatus']): void {
  db().update(clips).set({ publishStatus: status }).where(eq(clips.id, id)).run()
}

/** Prochain clip validé, non publié, avec un fichier — pour la publication auto. */
export function nextApprovedUnpublished(): ClipDTO | null {
  const rows = db()
    .select()
    .from(clips)
    .where(eq(clips.reviewStatus, 'approved'))
    .orderBy(clips.createdAt)
    .all()
  // On (re)publie les clips jamais publiés ET ceux en échec (ex. saturation d'un
  // compte à un instant donné) : avec la rotation/bascule, un nouvel essai peut
  // aboutir sur un autre compte.
  const hit = rows.find((r) => (r.publishStatus === 'unpublished' || r.publishStatus === 'failed') && !!r.filePath)
  return hit ? toClipDTO(hit) : null
}

export function getSetting(key: string): string | null {
  const row = db().select().from(settings).where(eq(settings.key, key)).get()
  return row ? row.value : null
}

export function setSetting(key: string, value: string): void {
  db()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function deleteSetting(key: string): void {
  db().delete(settings).where(eq(settings.key, key)).run()
}

// ── Idées virales enregistrées ──
function toSavedIdea(r: IdeaRow): SavedIdea {
  const idea = JSON.parse(r.data) as ViralIdea
  return { id: r.id, niche: r.niche, createdAt: r.createdAt, ...idea }
}

export function createIdea(niche: string, idea: ViralIdea): SavedIdea {
  const row = db()
    .insert(ideas)
    .values({ niche, title: idea.title, data: JSON.stringify(idea), createdAt: Date.now() })
    .returning()
    .get()
  return toSavedIdea(row)
}

export function listIdeas(): SavedIdea[] {
  return db().select().from(ideas).orderBy(desc(ideas.createdAt)).all().map(toSavedIdea)
}

export function deleteIdea(id: number): void {
  db().delete(ideas).where(eq(ideas.id, id)).run()
}
