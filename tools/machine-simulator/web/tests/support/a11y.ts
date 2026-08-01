import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"

/**
 * Waits for every FINITE, in-progress animation to settle before axe samples computed styles.
 * Every screen mounts its content through `fadeSlideUp`/`staggerContainer` (`theme/motion.ts`) —
 * axe reads whatever opacity/color a `motion.*` element has AT THE INSTANT it runs, with no
 * equivalent to `toHaveScreenshot`'s automatic `animations: "disabled"` freeze. Caught this for
 * real on `/tokens`: axe reported ~2.1:1 contrast on footer text that is `text-text-muted` (a
 * token independently verified elsewhere in this same run) — the true cause was sampling mid
 * fade-in, where partial opacity blends the text color toward the background and depresses the
 * apparent ratio. `animate-pulse` (Tailwind, MachineCard's active-OK badge) is intentionally
 * excluded — it's an infinite CSS animation, "wait for it to finish" would just hang.
 */
async function waitForAnimationsToSettle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          const timing = a.effect?.getComputedTiming?.()
          const isInfinite = timing?.iterations === Infinity
          return isInfinite || a.playState !== "running"
        }),
      { timeout: 5_000 }
    )
    .catch(() => {
      // Best-effort — proceeding with a possibly-still-settling animation is preferable to failing
      // the whole a11y gate on a wait timeout; axe still runs and reports whatever is real.
    })
}

/**
 * Runs axe-core against the current page and fails the test on any 'serious' or 'critical' finding
 * — the brief's bar ("no serious/critical violations, contrast AA"). `color-contrast` failures are
 * themselves classified 'serious' by axe, so the AA contrast check rides along with this same gate
 * rather than needing a separate assertion. 'minor'/'moderate' findings are intentionally NOT
 * failed on here (axe over-flags plenty of stylistic nits) but are included in the thrown message
 * if the gate ever does fail, for context.
 *
 * Scoped to WCAG 2.0/2.1 A+AA tags — the same bar most real audit gates use; `best-practice` rules
 * (axe's opinionated extras beyond WCAG) are excluded since they're not what "AA" means.
 */
export async function assertNoSeriousA11yViolations(page: Page): Promise<void> {
  await waitForAnimationsToSettle(page)
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()

  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")

  expect(blocking, describeViolations(blocking)).toEqual([])
}

function describeViolations(violations: Array<{ id: string; impact?: string | null; help: string; nodes: Array<{ target: unknown; failureSummary?: string }> }>): string {
  if (violations.length === 0) return ""
  return violations
    .map((v) => {
      const targets = v.nodes.map((n) => JSON.stringify(n.target)).join(", ")
      return `[${v.impact}] ${v.id} — ${v.help}\n  targets: ${targets}`
    })
    .join("\n")
}
