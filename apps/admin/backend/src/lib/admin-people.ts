import { isObjectId, type Person } from '@/lib/admin-stores';
import { User } from '@/lib/workspace';

/** Names and emails for a set of account ids, in one query. Unknown ids are left out of the map. */
export async function loadPeople(ids: Array<string | null>): Promise<Map<string, Person>> {
  // Sprint 6 (S6-B6, CO-11): the seller backend writes actor ids as admin:<id> or seller:<id>; the person is the id after the prefix.
  const bare = ids.map((id) => (id === null ? null : id.replace(/^(?:admin|seller):/, '')));
  const unique = [...new Set(bare.filter((id): id is string => id !== null && isObjectId(id)))];
  const people = new Map<string, Person>();
  if (unique.length === 0) return people;
  const rows = await User.find({ _id: { $in: unique } }).select('name email').lean();
  for (const row of rows) {
    people.set(String(row._id), { name: row.name, email: row.email });
    people.set('admin:' + String(row._id), { name: row.name, email: row.email });
    people.set('seller:' + String(row._id), { name: row.name, email: row.email });
  }
  return people;
}
