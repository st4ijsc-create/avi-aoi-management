/**
 * A2(n) T0 — a lazily imported module, imported ONCE: concurrent callers share one `import()`, a later caller gets the same answer. A failed import is not kept, the next caller tries
 * again. In a running process this changes nothing: an `import()` of a loaded module answers the same module. It is here for the tests: two concurrent `import()` of a mocked module from
 * one importer are not safe under vitest 2.1.9 (requestWithMock gives the later one the REAL module), so an alert or a fault injected into the mock would silently not happen.
 * A module a FOE test mocks is imported through this, in the file that uses it: foeNapMotLan.test.ts holds that as a census.
 */
export function napMotLan<T>(nap: () => Promise<T>): () => Promise<T> {
  let dang: Promise<T> | undefined;
  return () => {
    dang ??= nap().catch((err: unknown) => {
      dang = undefined;
      throw err;
    });
    return dang;
  };
}
