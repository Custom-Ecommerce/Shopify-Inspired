/** Operators the seller frontend uses. Anything else is rejected, not ignored. */
export const WHERE_OPERATORS = [
  'equals',
  'in',
  'like',
  'greater_than_equal',
  'less_than_equal',
  'exists',
] as const;

export type WhereOperator = (typeof WHERE_OPERATORS)[number];
export type WhereValue = string | number | boolean | string[];

export interface WhereClause {
  field: string;
  operator: WhereOperator;
  value: WhereValue;
}

/** Thrown for any malformed or unsupported where clause. `field` names the offending field when known. */
export class WhereParseError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = 'WhereParseError';
    this.field = field;
  }
}

const KEY_PATTERN = /^where\[([^\]]+)\]\[([^\]]+)\]$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value);
}

function coerceValue(field: string, operator: WhereOperator, raw: string): WhereValue {
  switch (operator) {
    case 'in': {
      const parts = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
      if (parts.length === 0) {
        throw new WhereParseError('where[' + field + '][in] needs at least one value', field);
      }
      return parts;
    }
    case 'exists': {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new WhereParseError('where[' + field + '][exists] must be true or false', field);
    }
    case 'greater_than_equal':
    case 'less_than_equal': {
      const numeric = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(numeric)) {
        throw new WhereParseError('where[' + field + '][' + operator + '] must be a finite number', field);
      }
      return numeric;
    }
    default:
      return raw;
  }
}

/**
 * Parses every where[field][operator]=value parameter, in order. Other parameters (page, limit, ...)
 * are ignored. A where key that does not match the grammar, an unknown operator, a bad field name
 * or a value of the wrong type throws WhereParseError.
 */
export function parseWhere(params: URLSearchParams | ReadonlyArray<readonly [string, string]>): WhereClause[] {
  const entries: Array<readonly [string, string]> =
    params instanceof URLSearchParams ? Array.from(params.entries()) : Array.from(params);
  const clauses: WhereClause[] = [];

  for (const [key, raw] of entries) {
    if (key !== 'where' && !key.startsWith('where[')) continue;

    const match = KEY_PATTERN.exec(key);
    if (!match) {
      throw new WhereParseError('malformed where clause "' + key + '": expected where[field][operator]');
    }
    const field = match[1];
    const operatorName = match[2];

    if (!FIELD_PATTERN.test(field)) {
      throw new WhereParseError('invalid field name "' + field + '"', field);
    }
    if (!isOperator(operatorName)) {
      throw new WhereParseError('unknown operator "' + operatorName + '" on field "' + field + '"', field);
    }
    clauses.push({ field, operator: operatorName, value: coerceValue(field, operatorName, raw) });
  }
  return clauses;
}
