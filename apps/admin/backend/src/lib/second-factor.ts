import { AdminSecondFactor } from '@/lib/workspace';

/** Sprint 9 (EP-31.US01.T07): where the admin second factor is kept. Every step that spends a code is ONE conditional write, so it is spent once. */

export interface SecondFactorRecord {
  secretSealed: string;
  confirmedAt: Date | null;
  lastUsedStep: number;
}

export interface SecondFactorStore {
  find(userId: string): Promise<SecondFactorRecord | null>;
  /** Starts (or restarts) an enrolment. Never overwrites a confirmed factor. */
  setPending(userId: string, secretSealed: string): Promise<void>;
  /** Confirms the pending enrolment that holds this sealed secret. False when somebody else was first. */
  confirm(userId: string, secretSealed: string, step: number, recoveryHashes: string[], at: Date): Promise<boolean>;
  /** Marks a time step used. False when that step (or a later one) was already used. */
  useStep(userId: string, step: number): Promise<boolean>;
  /** Removes one unused recovery code. False when it is not there (wrong, or used). */
  useRecoveryHash(userId: string, hash: string): Promise<boolean>;
  remove(userId: string): Promise<boolean>;
}

const model = AdminSecondFactor as any;

const databaseStore: SecondFactorStore = {
  async find(userId) {
    const row = (await model.findOne({ user: userId }).select('secretSealed confirmedAt lastUsedStep').lean()) as unknown as SecondFactorRecord | null;
    return row ? { secretSealed: String(row.secretSealed), confirmedAt: row.confirmedAt ?? null, lastUsedStep: typeof row.lastUsedStep === 'number' ? row.lastUsedStep : -1 } : null;
  },
  async setPending(userId, secretSealed) {
    try {
      await model.updateOne({ user: userId, confirmedAt: null }, { $set: { secretSealed, lastUsedStep: -1, recoveryHashes: [] } }, { upsert: true });
    } catch (err) {
      // A confirmed factor exists (the unique index refuses a second row): it is left as it is.
      if ((err as { code?: unknown } | null)?.code !== 11000) throw err;
    }
  },
  async confirm(userId, secretSealed, step, recoveryHashes, at) {
    const result = await model.updateOne({ user: userId, confirmedAt: null, secretSealed }, { $set: { confirmedAt: at, lastUsedStep: step, recoveryHashes } });
    return result.modifiedCount === 1;
  },
  async useStep(userId, step) {
    const result = await model.updateOne({ user: userId, confirmedAt: { $ne: null }, lastUsedStep: { $lt: step } }, { $set: { lastUsedStep: step } });
    return result.modifiedCount === 1;
  },
  async useRecoveryHash(userId, hash) {
    const result = await model.updateOne({ user: userId, confirmedAt: { $ne: null }, recoveryHashes: hash }, { $pull: { recoveryHashes: hash } });
    return result.modifiedCount === 1;
  },
  async remove(userId) {
    const result = await model.deleteOne({ user: userId });
    return result.deletedCount === 1;
  },
};

let store: SecondFactorStore = databaseStore;

/** Test seam. Pass null to go back to the database. */
export function setSecondFactorStore(next: SecondFactorStore | null): void {
  store = next ?? databaseStore;
}

export const secondFactors = (): SecondFactorStore => store;
