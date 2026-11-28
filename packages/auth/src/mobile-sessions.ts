import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { SessionUserRecord } from './session-guard';
import { SESSION_MIN_SECRET_LENGTH } from './session';
import type { MobileApp } from './mobile-app';

/*
 * Sprint 9 (EP-31.US01, D-120, D-123): the sign-in of the two phone apps, shared by the seller and the admin backend.
 *
 *   access token   a signed JWT, 15 minutes, with its own audience per app, carrying the account, its tokenVersion and the device family.
 *   refresh token  "mzr1.<family>.<nonce>.<mac>", 30 days, replaced on every use. The database holds only its SHA-256 hex. The mac shows that this
 *                  backend issued it, so a token that is genuine but no longer the current one is a REUSE (the family is revoked), while a made-up one
 *                  is only refused: nobody can end a stranger's session by guessing a family id.
 *
 * One family per device. A family dies when it is revoked, when its refresh token expires, when a used refresh token comes back, or when the account's
 * tokenVersion moves on (password change or reset, email change, sign out everywhere) or the account is not active.
 * No function here logs or throws a token.
 */

export const MOBILE_ACCESS_TTL_SECONDS = 15 * 60;
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MOBILE_SELLER_AUDIENCE = 'seller-mobile';
export const MOBILE_ADMIN_AUDIENCE = 'admin-mobile';

export type { MobileApp };
export type MobileRevokeReason = 'logout' | 'refresh_reuse' | 'device_revoked' | 'password_changed' | 'account_disabled' | 'replaced';

export interface MobileAccessClaims {
  sub: string;
  role: string;
  /** The account's tokenVersion at sign-in. */
  tv: number;
  /** The device family. */
  fam: string;
  /** Admin app only: the admin level at the time the token was issued. */
  lvl?: string;
}

function keyFor(secret: string): Uint8Array {
  if (!secret || secret.length < SESSION_MIN_SECRET_LENGTH) throw new Error('Session secret must be at least ' + SESSION_MIN_SECRET_LENGTH + ' characters.');
  return new TextEncoder().encode(secret);
}

export async function signMobileAccessToken(claims: MobileAccessClaims, secret: string, audience: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: claims.role, tv: claims.tv, fam: claims.fam, ...(claims.lvl === undefined ? {} : { lvl: claims.lvl }) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + MOBILE_ACCESS_TTL_SECONDS)
    .sign(keyFor(secret));
}

/** Verifies signature, pinned algorithm, expiry, audience and shape. Throws on any failure. */
export async function verifyMobileAccessToken(token: string, secret: string, audience: string): Promise<MobileAccessClaims> {
  const { payload } = await jwtVerify(token, keyFor(secret), { algorithms: ['HS256'], audience, requiredClaims: ['exp', 'sub'] });
  const { sub, role, tv, fam, lvl } = payload as Record<string, unknown>;
  if (typeof sub !== 'string' || typeof role !== 'string' || typeof fam !== 'string' || fam === '' || typeof tv !== 'number' || !Number.isInteger(tv) || tv < 0) {
    throw new Error('Malformed access token.');
  }
  return { sub, role, tv, fam, ...(typeof lvl === 'string' ? { lvl } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Refresh tokens

const REFRESH_PREFIX = 'mzr1';

const refreshMac = (family: string, nonce: string, secret: string, audience: string): Buffer =>
  createHmac('sha256', keyFor(secret)).update('mobile-refresh:' + audience + ':' + family + '.' + nonce).digest();

export const hashMobileRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const sameBytes = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

export function newMobileFamily(): string {
  return randomBytes(18).toString('base64url');
}

export function mintMobileRefreshToken(family: string, secret: string, audience: string): { token: string; hash: string } {
  const nonce = randomBytes(32).toString('base64url');
  const token = [REFRESH_PREFIX, family, nonce, refreshMac(family, nonce, secret, audience).toString('base64url')].join('.');
  return { token, hash: hashMobileRefreshToken(token) };
}

/** The family of a token this backend issued for this app, or null for anything else. */
export function readMobileRefreshToken(token: unknown, secret: string, audience: string): { family: string; hash: string } | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== REFRESH_PREFIX) return null;
  const [, family, nonce, mac] = parts as [string, string, string, string];
  if (!/^[A-Za-z0-9_-]{24}$/.test(family) || nonce === '') return null;
  const expected = refreshMac(family, nonce, secret, audience);
  // Compare the text form too, so a second spelling of the same bytes is not accepted.
  if (!sameBytes(Buffer.from(mac), Buffer.from(expected.toString('base64url')))) return null;
  return { family, hash: hashMobileRefreshToken(token) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage port

export interface MobileDeviceRecord {
  id: string;
  app: MobileApp;
  user: string;
  family: string;
  name: string;
  platform: string;
  appVersion: string;
  installationId: string | null;
  refreshHash: string;
  refreshExpiresAt: Date;
  tokenVersion: number;
  lastSeenAt: Date;
  pushToken: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

export type NewMobileDevice = Omit<MobileDeviceRecord, 'id' | 'createdAt' | 'pushToken' | 'revokedAt' | 'revokedReason'>;

export interface MobileRevokeScope {
  app: MobileApp;
  user: string;
  /** Only rows signed in at another tokenVersion than this one. */
  exceptTokenVersion?: number;
  installationId?: string;
}

export interface MobileDeviceStore {
  create(row: NewMobileDevice): Promise<{ id: string }>;
  findByFamily(family: string): Promise<MobileDeviceRecord | null>;
  /** The ONE compare-and-set of a refresh: only while the row is live and still holds `fromHash`. */
  rotate(family: string, fromHash: string, set: { refreshHash: string; refreshExpiresAt: Date; lastSeenAt: Date; appVersion?: string }): Promise<boolean>;
  revokeFamily(family: string, reason: MobileRevokeReason, at: Date): Promise<boolean>;
  /** Returns how many rows were revoked. */
  revokeAll(scope: MobileRevokeScope, reason: MobileRevokeReason, at: Date): Promise<number>;
  /** The rows of a user that are not revoked. */
  listForUser(app: MobileApp, user: string): Promise<MobileDeviceRecord[]>;
  findForUser(app: MobileApp, user: string, id: string): Promise<MobileDeviceRecord | null>;
  /** One active token per device, and a token on one device: it is taken off every other row first. null removes it. Only a live row gets one. */
  setPushToken(app: MobileApp, id: string, token: string | null): Promise<boolean>;
  /** Removes a token the push service calls invalid. */
  clearPushToken(token: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions

export interface MobileSessionDeps {
  app: MobileApp;
  audience: string;
  secret: string;
  devices: MobileDeviceStore;
  /** A FRESH read of the account (never a cache). */
  loadUser(userId: string): Promise<(SessionUserRecord & { adminLevel?: string }) | null>;
  /** The role an account must have to use this app. */
  role: 'seller' | 'admin';
  now?: () => Date;
}

export interface MobileTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const clock = (deps: MobileSessionDeps): Date => (deps.now ? deps.now() : new Date());

export interface StartMobileSessionInput {
  userId: string;
  tokenVersion: number;
  deviceName: string;
  platform: string;
  appVersion: string;
  installationId?: string | null;
  adminLevel?: string;
}

/** A new device with a new family. A known installationId first closes that installation's older rows. */
export async function startMobileSession(deps: MobileSessionDeps, input: StartMobileSessionInput): Promise<MobileTokens & { deviceId: string }> {
  const now = clock(deps);
  if (input.installationId) {
    await deps.devices.revokeAll({ app: deps.app, user: input.userId, installationId: input.installationId }, 'replaced', now);
  }
  const family = newMobileFamily();
  const refresh = mintMobileRefreshToken(family, deps.secret, deps.audience);
  const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TTL_MS);
  const { id } = await deps.devices.create({
    app: deps.app,
    user: input.userId,
    family,
    name: input.deviceName,
    platform: input.platform,
    appVersion: input.appVersion,
    installationId: input.installationId ?? null,
    refreshHash: refresh.hash,
    refreshExpiresAt,
    tokenVersion: input.tokenVersion,
    lastSeenAt: now,
  });
  const accessToken = await signMobileAccessToken(
    { sub: input.userId, role: deps.role, tv: input.tokenVersion, fam: family, ...(input.adminLevel === undefined ? {} : { lvl: input.adminLevel }) },
    deps.secret,
    deps.audience,
    now,
  );
  return { deviceId: id, accessToken, accessTokenExpiresIn: MOBILE_ACCESS_TTL_SECONDS, refreshToken: refresh.token, refreshTokenExpiresAt: refreshExpiresAt.toISOString() };
}

export type MobileRefreshResult =
  | { ok: true; tokens: MobileTokens; userId: string; deviceId: string }
  /** `reused` and `userId`/`deviceId` are for the audit line; the answer to the caller is the same for every `invalid`. */
  | { ok: false; code: 'SESSION_REVOKED' | 'ACCOUNT_SUSPENDED'; reused?: boolean; userId?: string; deviceId?: string };

export async function refreshMobileSession(deps: MobileSessionDeps, refreshToken: unknown, appVersion?: string): Promise<MobileRefreshResult> {
  const read = readMobileRefreshToken(refreshToken, deps.secret, deps.audience);
  if (!read) return { ok: false, code: 'SESSION_REVOKED' };
  const now = clock(deps);
  const device = await deps.devices.findByFamily(read.family);
  if (!device || device.app !== deps.app) return { ok: false, code: 'SESSION_REVOKED' };
  const who = { userId: device.user, deviceId: device.id };
  if (device.revokedAt !== null || device.refreshExpiresAt.getTime() <= now.getTime()) return { ok: false, code: 'SESSION_REVOKED', ...who };

  const reuse = async (): Promise<MobileRefreshResult> => {
    await deps.devices.revokeFamily(read.family, 'refresh_reuse', now);
    return { ok: false, code: 'SESSION_REVOKED', reused: true, ...who };
  };
  if (!sameBytes(Buffer.from(read.hash), Buffer.from(device.refreshHash))) return reuse();

  const user = await deps.loadUser(device.user);
  if (!user || user.role !== deps.role || user.accountStatus !== 'active') {
    await deps.devices.revokeAll({ app: deps.app, user: device.user }, 'account_disabled', now);
    return { ok: false, code: user && user.accountStatus !== 'active' ? 'ACCOUNT_SUSPENDED' : 'SESSION_REVOKED', ...who };
  }
  if (user.tokenVersion !== device.tokenVersion) {
    await deps.devices.revokeAll({ app: deps.app, user: device.user, exceptTokenVersion: user.tokenVersion }, 'password_changed', now);
    return { ok: false, code: 'SESSION_REVOKED', ...who };
  }

  const next = mintMobileRefreshToken(read.family, deps.secret, deps.audience);
  const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TTL_MS);
  const rotated = await deps.devices.rotate(read.family, read.hash, { refreshHash: next.hash, refreshExpiresAt, lastSeenAt: now, ...(appVersion ? { appVersion } : {}) });
  // Somebody else used this very token between the read and the write: that is a second use.
  if (!rotated) return reuse();

  const accessToken = await signMobileAccessToken(
    { sub: device.user, role: deps.role, tv: device.tokenVersion, fam: read.family, ...(user.adminLevel === undefined ? {} : { lvl: user.adminLevel }) },
    deps.secret,
    deps.audience,
    now,
  );
  return { ok: true, ...who, tokens: { accessToken, accessTokenExpiresIn: MOBILE_ACCESS_TTL_SECONDS, refreshToken: next.token, refreshTokenExpiresAt: refreshExpiresAt.toISOString() } };
}

/** Ends the family a genuine refresh token belongs to. Anything else does nothing; the caller answers the same either way. */
export async function endMobileSession(deps: MobileSessionDeps, refreshToken: unknown): Promise<{ userId: string; deviceId: string } | null> {
  const read = readMobileRefreshToken(refreshToken, deps.secret, deps.audience);
  if (!read) return null;
  const device = await deps.devices.findByFamily(read.family);
  if (!device || device.app !== deps.app) return null;
  const changed = await deps.devices.revokeFamily(read.family, 'logout', clock(deps));
  return changed ? { userId: device.user, deviceId: device.id } : null;
}

/** Whether the family behind a verified access token may still be served. */
export async function liveMobileDevice(deps: Pick<MobileSessionDeps, 'app' | 'devices' | 'now'>, claims: MobileAccessClaims): Promise<MobileDeviceRecord | null> {
  const device = await deps.devices.findByFamily(claims.fam);
  const now = deps.now ? deps.now() : new Date();
  if (!device || device.app !== deps.app || device.user !== claims.sub || device.tokenVersion !== claims.tv) return null;
  if (device.revokedAt !== null || device.refreshExpiresAt.getTime() <= now.getTime()) return null;
  return device;
}

/** The devices that can still use the account: not revoked, not expired and signed in at the current tokenVersion. */
export async function activeMobileDevices(deps: Pick<MobileSessionDeps, 'app' | 'devices' | 'now'>, userId: string, tokenVersion: number): Promise<MobileDeviceRecord[]> {
  const now = (deps.now ? deps.now() : new Date()).getTime();
  return (await deps.devices.listForUser(deps.app, userId)).filter((row) => row.revokedAt === null && row.refreshExpiresAt.getTime() > now && row.tokenVersion === tokenVersion);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stores

interface DeviceQuery {
  select(fields: string): DeviceQuery;
  sort(order: Record<string, 1 | -1>): DeviceQuery;
  limit(count: number): DeviceQuery;
  lean(): PromiseLike<unknown>;
}

/** The part of the MobileDevice model the Mongo store uses. */
export interface MobileDeviceModelPort {
  create(doc: Record<string, unknown>): PromiseLike<unknown>;
  findOne(filter: Record<string, unknown>): DeviceQuery;
  find(filter: Record<string, unknown>): DeviceQuery;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): PromiseLike<unknown>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): PromiseLike<unknown>;
}

/** The most rows a device list reads. */
const LIST_CAP = 100;

function toRecord(doc: unknown): MobileDeviceRecord | null {
  if (!doc || typeof doc !== 'object') return null;
  const row = doc as Record<string, unknown>;
  const date = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value ?? 0)));
  return {
    id: String(row._id),
    app: row.app as MobileApp,
    user: String(row.user),
    family: String(row.family),
    name: String(row.name ?? ''),
    platform: String(row.platform ?? ''),
    appVersion: String(row.appVersion ?? ''),
    installationId: typeof row.installationId === 'string' ? row.installationId : null,
    refreshHash: typeof row.refreshHash === 'string' ? row.refreshHash : '',
    refreshExpiresAt: date(row.refreshExpiresAt),
    tokenVersion: typeof row.tokenVersion === 'number' ? row.tokenVersion : 0,
    lastSeenAt: date(row.lastSeenAt),
    pushToken: typeof row.pushToken === 'string' ? row.pushToken : null,
    revokedAt: row.revokedAt ? date(row.revokedAt) : null,
    revokedReason: typeof row.revokedReason === 'string' ? row.revokedReason : null,
    createdAt: date(row.createdAt),
  };
}

const changedCount = (result: unknown): number => Number((result as { modifiedCount?: unknown } | null)?.modifiedCount ?? 0);

export function mongoMobileDeviceStore(model: MobileDeviceModelPort): MobileDeviceStore {
  const revoked = (reason: MobileRevokeReason, at: Date) => ({ $set: { revokedAt: at, revokedReason: reason, pushToken: null } });
  return {
    async create(row) {
      const doc = (await model.create({ ...row })) as { _id: unknown };
      return { id: String(doc._id) };
    },
    async findByFamily(family) {
      return toRecord(await model.findOne({ family }).select('+refreshHash').lean());
    },
    async rotate(family, fromHash, set) {
      return changedCount(await model.updateOne({ family, refreshHash: fromHash, revokedAt: null }, { $set: set })) === 1;
    },
    async revokeFamily(family, reason, at) {
      return changedCount(await model.updateOne({ family, revokedAt: null }, revoked(reason, at))) === 1;
    },
    async revokeAll(scope, reason, at) {
      return changedCount(
        await model.updateMany(
          {
            app: scope.app,
            user: scope.user,
            revokedAt: null,
            ...(scope.exceptTokenVersion === undefined ? {} : { tokenVersion: { $ne: scope.exceptTokenVersion } }),
            ...(scope.installationId === undefined ? {} : { installationId: scope.installationId }),
          },
          revoked(reason, at),
        ),
      );
    },
    async listForUser(app, user) {
      const rows = (await model.find({ app, user, revokedAt: null }).sort({ lastSeenAt: -1 }).limit(LIST_CAP).lean()) as unknown[];
      return rows.map(toRecord).filter((row): row is MobileDeviceRecord => row !== null);
    },
    async findForUser(app, user, id) {
      return toRecord(await model.findOne({ _id: id, app, user }).lean());
    },
    async setPushToken(app, id, token) {
      if (token !== null) await model.updateMany({ pushToken: token, _id: { $ne: id } }, { $set: { pushToken: null } });
      const result = await model.updateOne({ _id: id, app, revokedAt: null }, { $set: { pushToken: token } });
      return Number((result as { matchedCount?: unknown } | null)?.matchedCount ?? 0) === 1;
    },
    async clearPushToken(token) {
      await model.updateMany({ pushToken: token }, { $set: { pushToken: null } });
    },
  };
}

/** An in-process store for tests. */
export function memoryMobileDeviceStore(): MobileDeviceStore & { rows: MobileDeviceRecord[] } {
  const rows: MobileDeviceRecord[] = [];
  let next = 0;
  const revoke = (row: MobileDeviceRecord, reason: MobileRevokeReason, at: Date) => {
    row.revokedAt = at;
    row.revokedReason = reason;
    row.pushToken = null;
  };
  return {
    rows,
    async create(row) {
      next += 1;
      // 24 hex characters, the shape of an ObjectId.
      const id = 'a' + next.toString(16).padStart(23, '0');
      rows.push({ ...row, id, createdAt: row.lastSeenAt, pushToken: null, revokedAt: null, revokedReason: null });
      return { id };
    },
    async findByFamily(family) {
      const row = rows.find((candidate) => candidate.family === family);
      return row ? { ...row } : null;
    },
    async rotate(family, fromHash, set) {
      const row = rows.find((candidate) => candidate.family === family && candidate.refreshHash === fromHash && candidate.revokedAt === null);
      if (!row) return false;
      Object.assign(row, set);
      return true;
    },
    async revokeFamily(family, reason, at) {
      const row = rows.find((candidate) => candidate.family === family && candidate.revokedAt === null);
      if (!row) return false;
      revoke(row, reason, at);
      return true;
    },
    async revokeAll(scope, reason, at) {
      const hit = rows.filter(
        (row) =>
          row.app === scope.app &&
          row.user === scope.user &&
          row.revokedAt === null &&
          (scope.exceptTokenVersion === undefined || row.tokenVersion !== scope.exceptTokenVersion) &&
          (scope.installationId === undefined || row.installationId === scope.installationId),
      );
      for (const row of hit) revoke(row, reason, at);
      return hit.length;
    },
    async listForUser(app, user) {
      return rows
        .filter((row) => row.app === app && row.user === user && row.revokedAt === null)
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
        .map((row) => ({ ...row }));
    },
    async findForUser(app, user, id) {
      const row = rows.find((candidate) => candidate.id === id && candidate.app === app && candidate.user === user);
      return row ? { ...row } : null;
    },
    async setPushToken(app, id, token) {
      if (token !== null) for (const row of rows) if (row.pushToken === token && row.id !== id) row.pushToken = null;
      const row = rows.find((candidate) => candidate.id === id && candidate.app === app && candidate.revokedAt === null);
      if (!row) return false;
      row.pushToken = token;
      return true;
    },
    async clearPushToken(token) {
      for (const row of rows) if (row.pushToken === token) row.pushToken = null;
    },
  };
}
