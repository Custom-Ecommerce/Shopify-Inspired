/*
 * Sprint 8 (S8-B7): a small in-memory runner for the aggregation stages the analytics pipelines use ($match, $unwind, $sort, $group with $sum and $first,
 * $limit, $facet) and their expressions. It refuses anything it does not know, so a new operator in a pipeline fails the test instead of being ignored.
 * Not a MongoDB: strings sort by code point, as Mongo's binary comparison does.
 */

type Doc = Record<string, any>;

const get = (doc: Doc, path: string): any => path.split('.').reduce((value: any, key) => (value === null || value === undefined ? undefined : value[key]), doc);

const comparable = (value: unknown): any => {
  if (value instanceof Date) return value.getTime();
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return String(value);
  return value;
};

function evaluate(expression: any, doc: Doc): any {
  if (typeof expression === 'string') return expression.startsWith('$') ? get(doc, expression.slice(1)) : expression;
  if (expression === null || typeof expression !== 'object') return expression;
  const [key] = Object.keys(expression);
  if (key !== undefined && key.startsWith('$')) {
    const arg = expression[key];
    if (key === '$dateToString') return new Date(evaluate(arg.date, doc)).toISOString().slice(0, 10);
    if (key === '$ifNull') {
      const first = evaluate(arg[0], doc);
      return first === null || first === undefined ? evaluate(arg[1], doc) : first;
    }
    if (key === '$trim') return String(evaluate(arg.input, doc)).trim();
    if (key === '$multiply') return arg.reduce((product: number, part: unknown) => product * Number(evaluate(part, doc)), 1);
    throw new Error('the test runner does not know the expression ' + key);
  }
  return Object.fromEntries(Object.entries(expression).map(([name, value]) => [name, evaluate(value, doc)]));
}

function holds(actual: unknown, wanted: any): boolean {
  if (wanted === null) return actual === null || actual === undefined;
  if (typeof wanted === 'object' && !(wanted instanceof Date) && Object.keys(wanted).some((k) => k.startsWith('$'))) {
    return Object.entries(wanted).every(([op, value]: [string, any]) => {
      if (op === '$gte') return actual !== undefined && comparable(actual) >= comparable(value);
      if (op === '$gt') return actual !== undefined && comparable(actual) > comparable(value);
      if (op === '$lte') return actual !== undefined && comparable(actual) <= comparable(value);
      if (op === '$lt') return actual !== undefined && comparable(actual) < comparable(value);
      if (op === '$ne') return comparable(actual) !== comparable(value);
      if (op === '$in') return value.map(comparable).includes(comparable(actual));
      if (op === '$nin') return !value.map(comparable).includes(comparable(actual));
      throw new Error('the test runner does not know the operator ' + op);
    });
  }
  return comparable(actual) === comparable(wanted);
}

export const matchDoc = (doc: Doc, filter: Doc): boolean => Object.entries(filter).every(([key, wanted]) => holds(get(doc, key), wanted));

function sortDocs(docs: Doc[], by: Record<string, number>): Doc[] {
  return [...docs].sort((a, b) => {
    for (const [path, direction] of Object.entries(by)) {
      const x = comparable(get(a, path));
      const y = comparable(get(b, path));
      if (x !== y) return (x < y ? -1 : 1) * direction;
    }
    return 0;
  });
}

function group(docs: Doc[], spec: Doc): Doc[] {
  const { _id, ...fields } = spec;
  const groups = new Map<string, Doc>();
  for (const doc of docs) {
    const id = evaluate(_id, doc);
    const key = JSON.stringify(id, (_k, value) => (value === undefined ? null : value));
    let out = groups.get(key);
    const first = out === undefined;
    if (out === undefined) {
      out = { _id: id };
      groups.set(key, out);
    }
    for (const [name, accumulator] of Object.entries(fields) as Array<[string, Doc]>) {
      if ('$sum' in accumulator) out[name] = (out[name] ?? 0) + Number(evaluate(accumulator.$sum, doc) ?? 0);
      else if ('$first' in accumulator) {
        if (first) out[name] = evaluate(accumulator.$first, doc);
      } else throw new Error('the test runner does not know the accumulator ' + Object.keys(accumulator).join(','));
    }
  }
  return [...groups.values()];
}

export function runPipeline(source: readonly Doc[], pipeline: readonly Doc[]): Doc[] {
  let docs: Doc[] = [...source];
  for (const stage of pipeline) {
    const [op] = Object.keys(stage) as [string];
    const spec: any = stage[op];
    if (op === '$match') docs = docs.filter((doc) => matchDoc(doc, spec));
    else if (op === '$sort') docs = sortDocs(docs, spec);
    else if (op === '$limit') docs = docs.slice(0, spec);
    else if (op === '$group') docs = group(docs, spec);
    else if (op === '$unwind') {
      const field = spec.path.slice(1);
      docs = docs.flatMap((doc) => ((doc[field] ?? []) as unknown[]).map((item, index) => ({ ...doc, [field]: item, [spec.includeArrayIndex]: index })));
    } else if (op === '$facet') docs = [Object.fromEntries(Object.entries(spec as Record<string, Doc[]>).map(([name, sub]) => [name, runPipeline(docs, sub)]))];
    else throw new Error('the test runner does not know the stage ' + op);
  }
  return docs;
}

/** What Model.aggregate answers: awaitable, with allowDiskUse. */
export function aggregateResult(rows: () => readonly Doc[], pipeline: readonly Doc[], onDiskUse?: (allowed: boolean) => void) {
  const run = async () => runPipeline(rows(), pipeline);
  return {
    allowDiskUse: (allowed: boolean) => {
      onDiskUse?.(allowed);
      return run();
    },
    then: <T>(resolve: (value: Doc[]) => T, reject?: (reason: unknown) => T) => run().then(resolve, reject),
  };
}
