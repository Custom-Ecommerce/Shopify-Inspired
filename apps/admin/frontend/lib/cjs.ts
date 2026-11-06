/**
 * The workspace packages are CommonJS. A namespace import of one carries its exports directly, or under default when
 * a loader wraps it. Reflect.get reads default without a static member access, so the bundler does not warn about a
 * default export that is absent.
 */
export function unwrapCjs<T>(ns: T): T {
  const inner = Reflect.get(ns as unknown as object, "default") as T | undefined;
  return inner ?? ns;
}
