/**
 * The two annunciator constants that a TEST has to know the value of, extracted here so it can
 * IMPORT them instead of copying them.
 *
 * 🔴 Both were copied by hand into `tests/26-alarm-annunciator.spec.ts` — `SOUND_GATE_MS + 300` as a
 * literal `1_800`, and `SEEN_LIMIT + 1` as a literal `513`. Both copies fail the same way: raise the
 * constant here and the tests keep passing while no longer testing anything. A sleep of 1 800 ms no
 * longer crosses a 2 000 ms gate, so the sound gate — not de-duplication — is what suppresses the
 * second tone, and all three de-duplication tests become vacuous. 513 distinct sequences no longer
 * exceed a cap of 1 024, so no rotation happens and the cap test stops driving the boundary it exists
 * for. Neither failure is visible in a test run; `26-alarm-annunciator.spec.ts`'s own comment at the
 * de-duplication test records that the sound-gate case ALREADY happened once and was caught only by
 * mutation.
 *
 * They live in their own module rather than in `annunciator.tsx` because that file imports React and
 * `@/lib/api`, and the Playwright suite's own tsconfig (`tsconfig.tests.json`) has no `@/*` path
 * mapping — importing the component module from a spec would drag a browser-shaped dependency graph
 * into the Node test process for the sake of two numbers. Nothing here imports anything.
 */

/**
 * Minimum spacing between tones. `Restored` at engine start emits one edge per standing alarm, so
 * without this a restart with 40 standing alarms would fire 40 overlapping tones — noise that
 * annunciates nothing. The BANNER still lists every one of them; only the sound is coalesced.
 */
export const SOUND_GATE_MS = 1_500

/**
 * How many `sequence` values to remember for de-duplication. Bounded because a long-lived exhibition
 * page must not grow a set forever; far larger than any realistic burst.
 */
export const SEEN_LIMIT = 512
