// Sprint 6 (S6-B6, D-118): pure planning for scripts/migrate-admin-levels.mjs. No database, no env, no output.
// Every admin account that has no adminLevel becomes an owner, explicitly (the code already reads a missing level as owner, so nothing locks out either way).

export const MISSING_LEVEL_FILTER = Object.freeze({ role: 'admin', $or: [{ adminLevel: { $exists: false } }, { adminLevel: null }] });

/** What to do with a list of admin accounts: the ids that get owner, and how many already have a level. */
export function planAdminLevels(admins) {
  const toOwner = [];
  let alreadySet = 0;
  for (const admin of Array.isArray(admins) ? admins : []) {
    if (admin?.role !== 'admin') continue;
    if (typeof admin.adminLevel === 'string' && admin.adminLevel !== '') alreadySet += 1;
    else toOwner.push(String(admin._id));
  }
  return { toOwner, alreadySet };
}
