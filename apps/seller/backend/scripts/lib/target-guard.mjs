// SB-6 (verification bug 10): the database-name guard of the deploy scripts, for scripts/mark-sellers-verified.mjs (the other four deploy scripts have
// it in scripts/lib/*-plan.mjs). Pure: no database, no env. A database whose name contains "throwaway" is always allowed; any other needs
// --i-know-this-is-real, for the dry run too.

/** The database name of a Mongo URI. A regex, not new URL(): a replica-set URI lists several hosts, which URL() rejects. */
export function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(uri ?? ''));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function targetDecision(databaseName, { apply, iKnowThisIsReal }) {
  const name = String(databaseName ?? '').toLowerCase();
  if (name.includes('throwaway')) return { ok: true, reason: 'safe-name' };
  if (iKnowThisIsReal) return { ok: true, reason: apply ? 'confirmed-apply' : 'confirmed-dry-run' };
  return { ok: false, reason: 'needs-throwaway-name-or-flag' };
}
