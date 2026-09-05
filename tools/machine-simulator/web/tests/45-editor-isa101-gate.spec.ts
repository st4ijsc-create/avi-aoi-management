import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"

/**
 * Session 3 (WS-HMI-4), FIX ROUND 1, review H2 — THE JOIN BETWEEN THE LINTER AND THE PUBLISH BUTTON.
 *
 * ── WHY THIS FILE EXISTS, IN THE REVIEWER'S OWN TERMS ────────────────────────────────────────────
 * Round 0 shipped the linter with 46 executed pins and the gate wired into `PublishPanel.tsx`, and
 * the controller's review measured the gap: `grep -rn "isa101-blocked|isa101-error|isa101-warn" tests/
 * src/` returned only `PublishPanel.tsx` and the two i18n dictionaries, and Playwright went 296 → 296.
 * So "an `error` finding blocks publish" was proven as a property of the PURE FUNCTION `lintScreen`,
 * and that the BUTTON honours it rested on reading the source.
 *
 * That is the exact shape this programme keeps paying for, and `43-editor-acceptance.spec.ts`'s own
 * header names the precedent: twelve tasks each pinned their own half, "and nothing joined them: the
 * editor wrote into a store the operator panel never opened". WS-HMI-0c is the same lesson at another
 * address — a lambda handed a service a different store and left 1728 tests green. Both halves pinned
 * is not the thing working.
 *
 * A refactor that dropped `|| lint.blocksPublish` from the `disabled` expression, or renamed a
 * `data-isa101-*` attribute, reddened NOTHING before this file. It does now.
 *
 * ── 🔴 WHAT MAKES THIS TESTABLE AT ALL: THE WRITE DOOR AND THE LINTER DISAGREE, ON PURPOSE ───────
 * The document seeded below is one `PUT /v1/screens/{id}` ACCEPTS (measured: `validate()` returns `[]`
 * against the frozen schema) and the linter BLOCKS. That is not a contradiction to be fixed — it is
 * the session's central design decision, argued in `PublishPanel.tsx`: the linter encodes a DOCTRINE
 * (ISA-101) at the button, the write door encodes a CONTRACT (the frozen schema plus §5's safety
 * invariants) at the endpoint. A doctrine enforced at the endpoint would be un-opt-out-able for every
 * future non-editor writer, the generator included.
 *
 * It is also what lets this test exist: the error document can be seeded through the real store and
 * then opened in the editor, without an API stub anywhere.
 *
 * ── THE TWO DOCUMENTS, AND WHY EACH IS THE SHAPE IT IS ───────────────────────────────────────────
 *   * ERROR — a `state-badge` whose three states all map to `"run"`. That is R1 case (b): the colour
 *     cannot tell those states apart. Chosen over the other four `error` rules because it needs no
 *     write path, no policy action and no geometry — the document differs from the warn one by the
 *     WIDGET ALONE, so what the button does can only be about the finding.
 *   * WARN-ONLY — a plain `label` screen. It still produces `warn: no-route-to-alarm-state`, which is
 *     the point: it proves the button is enabled while findings are PRESENT, not merely while the
 *     report is empty. A warn-only document that produced no findings at all would leave "does `warn`
 *     block?" untested.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT RE-PROVE ────────────────────────────────────────────────
 * Which documents violate which rule, and at what severity, is `runtime-tests/isa101Linter.test.mjs`'s
 * job — 54 executed pins, each with a falsification and a negative control. This file asserts ONE
 * thing that file cannot: that the browser's Publish button agrees with `blocksPublish`. Duplicating
 * the rule corpus here would be slow and would put a second copy of the rules in the tree.
 */

const ERROR_SCREEN = "isa101-gate-error"
const WARN_SCREEN = "isa101-gate-warn"
const WARN_TEXT = "ISA101-GATE-WARN-TEXT"

type GateDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  theme: string
  layout: { cols: number; rows: number; breakpoint: string }
  widgets: Array<Record<string, unknown>>
}

/**
 * A screen the frozen schema ACCEPTS and the ISA-101 linter BLOCKS: three states, one status colour.
 * `bindings.state` is present on purpose — without it this would trip R1's OTHER branch (the unbound
 * map), and the test would pass for a reason it did not mean to measure.
 */
function errorDoc(): GateDocument {
  return {
    schemaVersion: 1,
    screenId: ERROR_SCREEN,
    title: "ISA-101 gate — blocking",
    theme: "isa101",
    layout: { cols: 12, rows: 4, breakpoint: "panel" },
    widgets: [
      {
        id: "deco",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "run", stopped: "run", faulted: "run" } },
      },
    ],
  }
}

/** A screen that produces `warn` findings and no `error` — so "enabled" is measured while the panel
 * has something to say, not merely while it is silent. */
function warnDoc(): GateDocument {
  return {
    schemaVersion: 1,
    screenId: WARN_SCREEN,
    title: "ISA-101 gate — warn only",
    theme: "isa101",
    layout: { cols: 12, rows: 4, breakpoint: "panel" },
    widgets: [
      {
        id: "cap",
        kind: "label",
        rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 },
        props: { text: WARN_TEXT },
      },
    ],
  }
}

async function putScreen(request: APIRequestContext, doc: GateDocument): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) {
    throw new Error(
      `PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}. ` +
        `This test REQUIRES the write door to accept a document the linter blocks — if the door has ` +
        `started refusing it, the doctrine has leaked into the contract and that is the thing to fix.`
    )
  }
}

async function openEditor(page: Page, screenId: string): Promise<void> {
  await page.goto(`/editor/${screenId}`)
  await expect(page.locator(`[data-editor-canvas="${screenId}"]`)).toBeVisible()
  await expect(page.locator("[data-publish-panel]")).toBeVisible()
}

test.describe("the ISA-101 gate on the publish button", () => {
  test("🔴 an `error` document leaves Publish DISABLED, and the panel names the rule", async ({
    page,
    request,
  }) => {
    await putScreen(request, errorDoc())
    await openEditor(page, ERROR_SCREEN)

    // 1. THE BUTTON. This is the assertion the whole file exists for.
    await expect(page.locator("[data-publish-button]")).toBeDisabled()

    // 2. The refusal is ANNOUNCED, not silent — this panel's standing rule is that every refusal
    //    lands on the control that caused it, and a button that is merely greyed out tells an
    //    engineer nothing about why.
    const blocked = page.locator("[data-isa101-blocked]")
    await expect(blocked).toBeVisible()
    await expect(blocked).toHaveAttribute("data-isa101-blocked", "1")

    // 3. The finding names the RULE, by its stable id, so this assertion does not depend on prose a
    //    translator may legitimately reword.
    await expect(
      page.locator('[data-isa101-error="status-colour-as-decoration"]')
    ).toBeVisible()

    // 4. ...and it names the widget, because a screen-wide "something is wrong" is not actionable.
    await expect(page.locator('[data-isa101-error="status-colour-as-decoration"]')).toContainText("deco")
  })

  test("🔴 a `warn`-only document leaves Publish ENABLED, and the warnings are still shown", async ({
    page,
    request,
  }) => {
    await putScreen(request, warnDoc())
    await openEditor(page, WARN_SCREEN)

    // THE NEGATIVE CONTROL FOR THE GATE ITSELF. Without this, a gate that disabled the button on
    // EVERY document would pass the test above — the same failure mode the linter's own negative
    // controls exist to catch, one level up.
    await expect(page.locator("[data-publish-button]")).toBeEnabled()

    // No blocking block at all — not merely a zero count.
    await expect(page.locator("[data-isa101-blocked]")).toHaveCount(0)

    // ...and the `warn` findings ARE rendered, so "enabled" is not being confused with "the linter
    // found nothing". This is what makes the two severities distinguishable rather than just two
    // words in a type.
    await expect(page.locator("[data-isa101-warnings]")).toBeVisible()
    await expect(page.locator('[data-isa101-warn="no-route-to-alarm-state"]')).toBeVisible()
  })

  test("🔴 the gate is the ONLY difference: the same session publishes once the finding is gone", async ({
    page,
    request,
  }) => {
    // 🔴 The strongest form of the claim, and the one that rules out "the button was disabled for some
    // OTHER reason". The error document is opened, the button is disabled; the offending widget is
    // deleted through the layer tree — a real edit, the way an engineer makes it — and the button
    // becomes enabled in the SAME session, with no reload and no second document.
    await putScreen(request, errorDoc())
    await openEditor(page, ERROR_SCREEN)
    await expect(page.locator("[data-publish-button]")).toBeDisabled()

    await page.locator('[data-layer-remove="deco"]').click()
    await expect(page.locator(`[data-hmi-screen="${ERROR_SCREEN}"] [data-hmi-widget]`)).toHaveCount(0)

    await expect(page.locator("[data-isa101-blocked]")).toHaveCount(0)
    await expect(page.locator("[data-publish-button]")).toBeEnabled()
  })
})
