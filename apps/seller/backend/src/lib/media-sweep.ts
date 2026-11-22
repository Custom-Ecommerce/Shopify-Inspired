import { deleteAsset } from '@/lib/cloudinary';
import { findMediaUsage } from '@/lib/media-usage';
import { Media, writeAuditLog } from '@/lib/services';

/**
 * Sprint 7 (S7-B1, CO-10): the orphan sweep. A file the seller uploaded and then never used (or stopped using) stays in the library and in Cloudinary
 * for ever. The sweep lists the media records that NO registered feature uses (lib/media-usage.ts) and that are older than N days, and, only when told
 * to apply, removes them. It is a hand-called job (see the scheduler table in SETUP.md), never scheduled by the code.
 *
 * Safety: a DRY RUN unless `apply` is true. A record is judged by the media registry, so a feature added later protects its own files without a change
 * here. The usage is checked again right before each delete. The scan is bounded (SWEEP_SCAN_LIMIT records per run, oldest first, resumable with `after`).
 */

export const SWEEP_DEFAULT_DAYS = 30;
export const SWEEP_MIN_DAYS = 1;
export const SWEEP_MAX_DAYS = 365;
export const SWEEP_SCAN_LIMIT = 500;
/** How many orphans a dry run lists by name; the count is always complete for the scanned records. */
export const SWEEP_SAMPLE = 50;

/** The Cloudinary side of a delete, as a port: the route passes the real one, a test passes a fake. */
export interface SweepFilePort {
  deleteFile(publicId: string, resource: 'image' | 'video'): Promise<boolean>;
}

export const cloudinaryFilePort: SweepFilePort = { deleteFile: (publicId, resource) => deleteAsset(publicId, resource) };

export interface SweepOrphan {
  id: string;
  store: string;
  name: string | null;
  createdAt: string | null;
}

export interface SweepResult {
  dryRun: boolean;
  olderThanDays: number;
  cutoff: string;
  /** Records looked at in this run. */
  scanned: number;
  /** Of those, how many no feature uses. */
  orphanCount: number;
  /** The first SWEEP_SAMPLE of them. */
  orphans: SweepOrphan[];
  /** Records removed (0 in a dry run). */
  deleted: number;
  /** Records removed whose Cloudinary file could not be deleted (the leftover is logged by deleteAsset). */
  fileFailures: number;
  /** Records that became used between the listing and the delete, and so were kept. */
  keptInUse: number;
  /** More records are older than the cutoff than this run scanned: run again with `after` set to nextAfter. */
  more: boolean;
  nextAfter: string | null;
}

interface Row {
  _id: unknown;
  store?: unknown;
  alt?: unknown;
  name?: unknown;
  cloudinaryPublicId?: unknown;
  resourceType?: unknown;
  createdAt?: unknown;
}

const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

export async function sweepOrphanMedia(options: {
  apply: boolean;
  olderThanDays: number;
  now: Date;
  after?: string | null;
  files?: SweepFilePort;
  actorId?: string;
}): Promise<SweepResult> {
  const { apply, olderThanDays, now } = options;
  const files = options.files ?? cloudinaryFilePort;
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = { createdAt: { $lt: cutoff } };
  if (options.after) filter._id = { $gt: options.after };

  const rows = (await Media.find(filter)
    .sort({ _id: 1 })
    .limit(SWEEP_SCAN_LIMIT + 1)
    .select('store alt name cloudinaryPublicId resourceType createdAt')
    .lean()) as unknown as Row[];
  const more = rows.length > SWEEP_SCAN_LIMIT;
  const scanned = more ? rows.slice(0, SWEEP_SCAN_LIMIT) : rows;

  const orphans: Row[] = [];
  for (const row of scanned) {
    const usage = await findMediaUsage(String(row.store), String(row._id));
    if (!usage.inUse) orphans.push(row);
  }

  let deleted = 0;
  let fileFailures = 0;
  let keptInUse = 0;
  if (apply) {
    for (const row of orphans) {
      const storeId = String(row.store);
      const mediaId = String(row._id);
      // Judged again right before the delete: a file can be attached in the meantime.
      if ((await findMediaUsage(storeId, mediaId)).inUse) {
        keptInUse += 1;
        continue;
      }
      const removed = (await Media.findOneAndDelete({ _id: mediaId, store: storeId }).lean()) as Row | null;
      if (!removed) continue;
      deleted += 1;
      if (typeof row.cloudinaryPublicId === 'string' && row.cloudinaryPublicId !== '') {
        const ok = await files.deleteFile(row.cloudinaryPublicId, row.resourceType === 'video' ? 'video' : 'image');
        if (!ok) fileFailures += 1;
      }
    }
    try {
      await writeAuditLog('media.orphan-sweep', 'media', 'sweep', options.actorId ?? 'system:media-sweep', {
        olderThanDays,
        scanned: scanned.length,
        orphans: orphans.length,
        deleted,
        fileFailures,
        keptInUse,
        at: now.toISOString(),
      });
    } catch (err) {
      console.error('[seller-backend] could not write the media sweep audit entry', err instanceof Error ? err.message : 'unknown');
    }
  }

  const last = scanned[scanned.length - 1];
  return {
    dryRun: !apply,
    olderThanDays,
    cutoff: cutoff.toISOString(),
    scanned: scanned.length,
    orphanCount: orphans.length,
    orphans: orphans.slice(0, SWEEP_SAMPLE).map((row) => ({
      id: String(row._id),
      store: String(row.store),
      name: typeof row.name === 'string' && row.name !== '' ? row.name : typeof row.alt === 'string' ? row.alt : null,
      createdAt: iso(row.createdAt),
    })),
    deleted,
    fileFailures,
    keptInUse,
    more,
    nextAfter: more && last ? String(last._id) : null,
  };
}
