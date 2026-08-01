import { SOUND_GATE_MS } from "../../src/lib/annunciator-timing"

/**
 * Every wait this suite bounds ABOVE OR BELOW the project default, in one place, each one a measured
 * cost with its margin stated.
 *
 * ## Why there are so few numbers here
 *
 * Before this file, `{ timeout: 15_000 }` appeared at 40 sites — on `waitForEngineConnected`, on
 * every "past the loading skeleton" assertion, on every `<h1>` check. It was not per-site knowledge;
 * it was the project default written out forty times, at a value nobody had measured. A run with a
 * step-level reporter (task-2-report.md §3) put real numbers on all forty:
 *
 * ```
 *   tests/support/screens.ts:15  waitForEngineConnected   n=137   max   596 ms   declared 15 000
 *   tests/support/screens.ts:36  machine-detail <h1>      n= 20   max   533 ms   declared 15 000
 *   …the other 38 sites                                          max ≤ 600 ms   declared 15 000
 * ```
 *
 * A bound 25x-1000x the thing it bounds is not a safety margin, it is a number with no relationship
 * to its subject — and forty copies of it summed past the 45 000 ms per-test ceiling in 45 tests, so
 * most of them could never have been reached anyway. Those forty annotations are gone: they now use
 * `playwright.config.ts`'s `expect.timeout`, which is ONE reviewed decision with ONE measured
 * justification instead of forty unmeasured copies, and at 10 000 ms is a tightening of every one of
 * them.
 *
 * What is left in this file is the set of waits that genuinely need a bound of their own. Each is
 * either (a) a cost — the engine or a server operation really does take this long — or (b) a
 * deliberate tightening below the default. There are no liveness-only numbers left: a wait with
 * nothing behind it belongs on the project default.
 */

/**
 * (a) COST — the simulated fleet has to actually produce cycles before the assertion can be true.
 *
 * The slowest machine in `fleet.json` cycles every 2.0 s (AOI-02; AOI-01 is 1.8 s, the automation
 * machines 0.8-1.4 s), and no site using this bound needs more than about five of them. Measured
 * maxima across every such site in a full run: 1 989 ms (`04-onboarding` cycles climb off zero),
 * 1 353 ms (`01-dashboard` KPI leaves "none online"), 470 ms (`03-inspector` totals climb), and
 * ≤ 70 ms everywhere else. 10 000 ms is 5x the worst measured cost and ≥ 5 cycles of the slowest
 * machine in the roster.
 */
export const LIVE_CYCLES_MS = 10_000

/**
 * (a) COST — as above, but for waits on the FLEET as a whole rather than on one named machine: a
 * frame off the live inspector WebSocket, the fleet's own lifetime cycle counter climbing. Eleven
 * machines cycling at 0.8-2.0 s produce a cycle roughly every 100 ms between them, so 5 000 ms is
 * ~50 fleet cycles. Measured maxima at these sites: 470 ms and 60 ms.
 */
export const LIVE_STREAM_MS = 5_000

/**
 * (a) COST — a server operation with its own, longer bounded timeout, whose OUTCOME (usually a
 * failure) is what the test asserts. The longest of them is
 * `ConnectorEndpoints.ConnectionTestTimeout` (8 s, C# side), then `ResilienceProbe`'s own probe
 * timeout (5 s) and `SiteDiscovery`'s bounded mDNS browse (~4 s). Measured maxima: 8 520 ms
 * (`24-connectors` connection test — 8 s server bound plus a round trip), 4 486 ms (`21-site`
 * discovery), 2 447 ms (`04-onboarding` live register against an unreachable port), 2 394 ms
 * (`05-settings` unreachable probe).
 *
 * This one is deliberately NOT tightened to the measured 8.5 s: the cost is set by a constant on the
 * other side of the HTTP boundary that TypeScript cannot import, so the margin has to absorb a change
 * to it. If `ConnectionTestTimeout` ever exceeds this, the failure is a clean timeout naming this
 * bound rather than a silent pass.
 */
export const SERVER_BOUNDED_OP_MS = 15_000

/**
 * (b) TIGHTENING — a request/response/event the click just made is expected essentially immediately;
 * these are only awaited to capture a payload or prove a call happened. Playwright's own default for
 * `waitForRequest`/`waitForResponse`/`waitForEvent` is 30 000 ms, which nobody here chose. Measured
 * maxima across all seven such sites: 430 ms, 248 ms, 122 ms, 103 ms, 87 ms, 79 ms, 59 ms.
 */
export const REQUEST_ROUND_TRIP_MS = 5_000

/**
 * (b) TIGHTENING — a screen that polls the engine (~1 s interval) must reflect a change made from
 * somewhere else within a few poll intervals. The point of the assertion is that it happens SOON,
 * so the default would be too generous to prove it. Measured maxima 1 366 ms and 854 ms.
 */
export const POLL_RESYNC_MS = 5_000

/**
 * (b) TIGHTENING — finite enter/fade animations must settle before axe samples computed styles.
 * Best-effort by design (see `a11y.ts`), so this is the cap on how much of the test budget a page
 * whose animations never settle is allowed to burn. Measured max 2 446 ms over 94 calls, mean
 * 204 ms.
 */
export const ANIMATIONS_SETTLE_MS = 5_000

/**
 * (a) COST — the historian must have real rows on file before a browse screen can render any.
 * `setFleetRunning(true)` runs immediately before this, and 11 machines cycling at 0.8-2.0 s produce
 * the five rows required in well under a second. Measured max 14 ms over 6 calls (the historian is
 * already populated by the time these specs run); the bound covers the cold case where it is not.
 */
export const HISTORIAN_ROWS_MS = 10_000

/**
 * 🔴 DERIVED, not copied. `26-alarm-annunciator.spec.ts` has to sleep past the annunciator's sound
 * gate so that ONLY `sequence` de-duplication can suppress the second tone — if the sleep lands
 * inside the gate, the gate does the suppressing and all three de-duplication tests pass with
 * de-duplication deleted. That is not hypothetical: the file's own comment records it happening once,
 * caught only by mutation. It was written as a hand-copied `1_800`, i.e. `SOUND_GATE_MS + 300` with
 * the relationship left in a comment, so raising the product constant past 1 800 would have made all
 * three vacuous again, silently. Importing it makes the relationship the code.
 */
export const PAST_SOUND_GATE_MS = SOUND_GATE_MS + 300

/**
 * How long to let a tone that must NOT be scheduled fail to be scheduled. There is no positive signal
 * for "nothing happened", so this is a real sleep — the shortest one that still clears the
 * annunciator's own synchronous dispatch (one Critical tone is 3 pulses at 90 ms spacing).
 */
export const TONE_SETTLE_MS = 300
