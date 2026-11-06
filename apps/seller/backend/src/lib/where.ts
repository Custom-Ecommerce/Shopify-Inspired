/* patch_orders_fix: translate the dashboard's Payload-style "where" JSON into a safe MongoDB filter */
import { HttpError } from '@/lib/http';

export type FieldKind = 'string' | 'number' | 'date' | 'boolean';

/** Parses the ?where= query parameter (a JSON object), or null when absent. */
export function parseWhereParam(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* falls through to the 400 below */
  }
  throw new HttpError(400, 'where must be a JSON object');
}

/** The store id named by { store: { equals } }, at the top level or inside "and". */
export function storeEqualsOf(where: Record<string, unknown> | null): string | null {
  if (!where) return null;
  const direct = (where.store as { equals?: unknown } | undefined)?.equals;
  if (typeof direct === 'string' && direct !== '') return direct;
  const and = where.and;
  if (Array.isArray(and)) {
    for (const part of and) {
      if (part !== null && typeof part === 'object' && !Array.isArray(part)) {
        const found = storeEqualsOf(part as Record<string, unknown>);
        if (found) return found;
      }
    }
  }
  return null;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

function coerce(kind: FieldKind, value: unknown, field: string): unknown {
  switch (kind) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid number for ' + field);
      return n;
    }
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Invalid date for ' + field);
      return d;
    }
    case 'boolean':
      return value === true || value === 'true';
    default:
      if (typeof value !== 'string') throw new HttpError(400, 'Invalid value for ' + field);
      return value;
  }
}

function convertField(field: string, ops: unknown, spec: Record<string, FieldKind>): Record<string, unknown> | null {
  if (field === 'store') return null; // the store scope is enforced separately, never taken from the filter
  const kind = spec[field];
  if (!kind) throw new HttpError(400, 'Unsupported filter field: ' + field);
  if (ops === null || typeof ops !== 'object' || Array.isArray(ops)) throw new HttpError(400, 'Invalid filter for ' + field);

  const out: Record<string, unknown> = {};
  for (const [op, raw] of Object.entries(ops as Record<string, unknown>)) {
    switch (op) {
      case 'equals': out.$eq = coerce(kind, raw, field); break;
      case 'not_equals': out.$ne = coerce(kind, raw, field); break;
      case 'in':
      case 'not_in': {
        if (!Array.isArray(raw)) throw new HttpError(400, op + ' needs a list for ' + field);
        out[op === 'in' ? '$in' : '$nin'] = raw.map((v) => coerce(kind, v, field));
        break;
      }
      case 'greater_than': out.$gt = coerce(kind, raw, field); break;
      case 'greater_than_equal': out.$gte = coerce(kind, raw, field); break;
      case 'less_than': out.$lt = coerce(kind, raw, field); break;
      case 'less_than_equal': out.$lte = coerce(kind, raw, field); break;
      case 'like':
      case 'contains': {
        if (kind !== 'string') throw new HttpError(400, op + ' only works on text fields (' + field + ')');
        out.$regex = escapeRegex(String(raw));
        out.$options = 'i';
        break;
      }
      case 'exists': out.$exists = raw === true || raw === 'true'; break;
      default:
        throw new HttpError(400, 'Unsupported filter operator: ' + op);
    }
  }
  return { [field]: out };
}

/** Builds a MongoDB filter from a "where" object, allowing only the fields in spec. Null when empty. */
export function buildFilter(where: Record<string, unknown> | null, spec: Record<string, FieldKind>): Record<string, unknown> | null {
  if (!where) return null;
  const parts: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value)) throw new HttpError(400, key + ' must be a list');
      const subs: Record<string, unknown>[] = [];
      for (const item of value) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Invalid ' + key + ' clause');
        const sub = buildFilter(item as Record<string, unknown>, spec);
        if (sub) subs.push(sub);
      }
      if (subs.length > 0) parts.push(key === 'and' ? { $and: subs } : { $or: subs });
    } else {
      const field = convertField(key, value, spec);
      if (field) parts.push(field);
    }
  }
  if (parts.length === 0) return null;
  return parts.length === 1 ? (parts[0] as Record<string, unknown>) : { $and: parts };
}

/** Parses ?sort=-createdAt,total against an allow-list. */
export function parseSort(raw: string | null, allowed: readonly string[], fallback: Record<string, 1 | -1>): Record<string, 1 | -1> {
  if (raw === null || raw.trim() === '') return fallback;
  const sort: Record<string, 1 | -1> = {};
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (token === '') continue;
    const desc = token.startsWith('-');
    const name = desc ? token.slice(1) : token;
    if (!allowed.includes(name)) throw new HttpError(400, 'Unsupported sort field: ' + name);
    sort[name] = desc ? -1 : 1;
  }
  return Object.keys(sort).length > 0 ? sort : fallback;
}
