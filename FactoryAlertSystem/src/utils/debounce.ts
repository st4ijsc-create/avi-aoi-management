/**
 * Factory Alert System - Debounce helper (Wave 2A)
 *
 * Small, typed debounce used to coalesce bursty disk writes (AsyncStorage) so
 * that a store isn't serialized + persisted on EVERY MQTT message. Extracted
 * from the proven pattern in stationInspectionStore.ts.
 *
 * The returned function carries:
 *  - flush():  run any pending call immediately (wire to app background/quit so
 *              nothing is lost when the OS suspends/kills the process)
 *  - cancel(): drop any pending call without running it
 */
export interface DebouncedFn<A extends any[]> {
  (...args: A): void;
  /** Invoke the pending call now (if one is scheduled) and clear the timer. */
  flush: () => void;
  /** Drop the pending call without running it. */
  cancel: () => void;
}

/**
 * Debounce `fn` by `ms` milliseconds. Only the most recent arguments are used
 * when the trailing call fires.
 */
export function debounce<A extends any[]>(
  fn: (...args: A) => void,
  ms: number,
): DebouncedFn<A> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = () => {
    timeout = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(run, ms);
  }) as DebouncedFn<A>;

  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      run();
    }
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastArgs = null;
  };

  return debounced;
}
