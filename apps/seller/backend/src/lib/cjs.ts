/**
 * The workspace packages are CommonJS. A namespace import of one carries its exports directly, or, when the
 * bundler wraps it, under `default`. Reflect.get reads `default` without a static member access, so the
 * bundler does not analyse it and does not warn about a default export that is absent.
 */
export function unwrapCjs<T>(ns: T): T {
  const inner = Reflect.get(ns as unknown as object, 'default') as T | undefined;
  return inner ?? ns;
}
