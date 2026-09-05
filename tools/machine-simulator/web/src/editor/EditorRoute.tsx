import { useState, type ReactNode } from "react"
import { useParams } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import type { HmiScreenDocument } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import { EngineApiError, useScreen, useScreenVersions } from "@/lib/api"
import { EditorCanvas } from "./EditorCanvas"
import { createBlankScreen } from "./editorState"
import { SCREEN_ID_PATTERN } from "@/hmi-runtime/publishedScreen"
import { useShadowedPanel } from "./shadowedPanel"

/**
 * WS-HMI-2 Task 8 — `/editor/:screenId`, the screen builder's shell.
 *
 * Mounted from `App.tsx`'s top-level `<Switch>`, OUTSIDE `<Shell>` — the same placement `/tokens` and
 * the two `/hmi/*` routes already use, and for the same reason: the sidebar/topbar chrome would eat
 * the width a design canvas needs, and nothing about this route belongs to the app's own navigation
 * model yet. Still behind `<AuthGate>` like every other route, because `GET /v1/screens/{screenId}`
 * requires an authenticated session.
 *
 * 🔴 FIX ROUND 1, task-8-review.md finding 7 — this sentence used to say the endpoint "sits behind the
 * backend's default-deny fallback policy". It does not, and the correction is not cosmetic: a reader
 * auditing auth would have followed that to `Program.cs`'s fallback and concluded the protection is
 * INCIDENTAL — something this route inherits and that a routing change could remove without anyone
 * noticing. The real mechanism is a DECLARED one, on the endpoint itself:
 * `HmiScreenEndpoints.cs:166` maps this route with `.RequireAuthorization(Policies.Operator)`, and
 * `:167`'s `PUT` carries `.RequireAuthorization(Policies.Engineer)`
 * (🔴 whole-branch review L-1 — these read `:135`/`:136` until now, which the security round's ~31-line
 * insertion above `MapHmiScreenEndpoints` moved; `:135` had become a line of a doc comment. The
 * BY-NAME half was still right, which is exactly why a line number that has drifted is worse than no
 * line number: it reads as precision. The reviewer resolved all twenty `file:NNN` citations this
 * branch touches and this was the only one that landed elsewhere.) — the read/write split named in
 * the next clause was always right, only the mechanism behind it was wrong. Both rows are pinned by
 * `RbacPolicyTests.cs`, at TWO line numbers: `:246` is the GET/Operator row and `:276` is the
 * PUT/Engineer row. (Fix round 2, task-8-re-review.md finding 6 — round 1 cited `:246` alone and said
 * it "pins both", which named one row for two claims.)
 *
 * ── THE THREE STATES, AND WHY 404 IS NOT ONE OF THE ERRORS ────────────────────────────────────────
 * `GET /v1/screens/{screenId}` is the one document endpoint in the HMI family that answers 404 for
 * something nobody declared — `HmiScreenEndpoints`'s own doc comment argues it at length ("there is no
 * such thing as a valid EMPTY screen"), unlike `/v1/components/{code}` and `/v1/tags?machine=`, which
 * answer an empty 200. Plan §5-bis then constrains what this route may do with that 404: an undeclared
 * screen must reach a NAMED not-found state — not a blank page, and not an error page. So the error
 * branch below splits on `EngineApiError.status`, and only the non-404 half is treated as a failure.
 * The two look nothing alike on screen on purpose: "nobody has authored this screen yet" is an
 * ordinary product state an engineer reaches by mistyping a URL, and "the engine is unreachable" is a
 * fault. Collapsing them into one apology is how a working system gets reported as broken.
 *
 * `35-hmi-indirect-binding.spec.ts`'s third test pins the same rule for the kiosk's own
 * `/hmi/demo/<unknown>`; this is that precedent applied to a route whose answer comes over HTTP rather
 * than from a static map.
 *
 * 🔴 WS-HMI-2 TASK 13 — "THE THREE STATES" IS NOW FOUR, and the heading above is kept verbatim rather
 * than renumbered because the fourth one is the point. The 404 branch stayed a NAMED DEAD END for five
 * tasks: correct under §5-bis, and with no way forward, so the only screens this editor could open
 * were ones something else had already created. It now offers "start this screen", whose document is
 * built by `editorState.ts`'s `createBlankScreen` and held in this component until publish — see the
 * `draft` state below for why the identity comes from the URL and why nothing is written on the way in.
 */

/** The page frame every state below renders inside — so the not-found and the failure states are
 * pages with a heading, a name and their own chrome, never a bare sentence on a white background.
 * `screenId` is echoed in the header in ALL states, including the ones with no document, because it is
 * the only thing the route knows for certain and it is what a mistyped URL needs to show back. */
function EditorShell({
  screenId,
  doc,
  children,
}: {
  screenId: string
  doc?: HmiScreenDocument
  children: ReactNode
}) {
  const t = useT()
  /**
   * WS-HMI-2 Task 12 — WHICH VERSION THE ENGINE IS CURRENTLY SERVING, in the header, in EVERY state.
   *
   * Read from `GET /v1/screens/{id}/versions` rather than from any publish result, and that is the
   * whole reason it lives up here instead of inside `PublishPanel`. The panel already knows what
   * number its own `PUT` returned; a surface that showed only that would agree with the mutation by
   * construction and could not tell anyone whether the write actually landed. This header reads the
   * server back, through a query the publish INVALIDATES, so when it moves it is because the engine
   * says so — a second, independent witness, which is what `tests/42-editor-publish.spec.ts` asserts
   * against after a publish and after a rollback.
   *
   * Rendered in the not-found and failure states too: "no versions" is the truthful answer for a
   * screen nobody has declared (that route answers 200 with `[]`, never 404 — see
   * `endpoints.screenVersions`), and it is exactly the sentence a mistyped URL needs to show back.
   */
  const versions = useScreenVersions(screenId)
  const head = versions.data?.find((row) => row.isCurrent)?.version
  // 🔴 FIX ROUND 1, task-8-review.md finding 8 — this used to read `t("editor.titleGloss")`, a key that
  // carried the OTHER language's text inside each dictionary (`vi` → "HMI SCREEN BUILDER", `en` →
  // "TRÌNH DỰNG MÀN HÌNH"). It worked, but it was a NEW idiom with no precedent, so nothing told the
  // next editor whether the cross-language values were deliberate or a swapped paste — and "fixing"
  // the swap would have silently deleted a bilingual header the design spec requires. This tree
  // already has the idiom: `useGloss()` (`components/hmi/bilingual.ts`) resolves a key against the
  // INACTIVE language's dictionary, which is exactly the gloss pairing `Sheet`'s `titleEn` and
  // `Readout`'s `labelEn` use throughout the HMI (spec §3). One key, one meaning per dictionary,
  // nothing to mistake for a paste error — and `editor.titleGloss` is deleted from both.
  const gloss = useGloss()
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-surface-subtle text-text-body">
      <header className="flex shrink-0 flex-col gap-1 border-b border-border-strong px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-heading text-lg font-semibold text-text-strong">{t("editor.title")}</h1>
          <span className="hmi-micro">{gloss("editor.title")}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="hmi-micro">{t("editor.screenIdLabel")}</span>
          <span data-editor-screen-id className="font-heading text-sm font-semibold text-text-strong">
            {screenId}
          </span>
          {doc ? <span className="text-sm text-text-muted">{doc.title}</span> : null}
          {doc ? (
            <span className="hmi-micro normal-case">{t("editor.widgetCount", { count: doc.widgets.length })}</span>
          ) : null}
          <span data-editor-current-version={head ?? ""} className="hmi-micro normal-case">
            {head === undefined ? t("editor.notPublished") : t("editor.currentVersion", { version: head })}
          </span>
        </div>
        {/*
          The honesty line `EditorCanvas`'s own header defers to. The canvas draws through the runtime
          renderer against a FABRICATED `MachineDetail` (see `DESIGN_TIME_SNAPSHOT`), and the quality
          bits are deliberately not downgraded to make that visible — so it has to be visible HERE
          instead, on every load, in chrome an engineer cannot scroll past. Rendered in every state,
          including not-found, because the claim is about the surface, not about one document.
        */}
        <p data-editor-design-mode className="hmi-micro normal-case text-text-muted">
          {t("editor.designMode")}
        </p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col p-3">{children}</main>
    </div>
  )
}

/** A named state with a heading and a reason — the shape §5-bis requires of "no screen here" and the
 * shape a real failure gets too. Deliberately NOT two different components: the difference between
 * them is the words, and a second component is a second place to forget the heading.
 *
 * 🔴 FIX ROUND 1, task-8-review.md finding 6 — `role` is a PARAMETER now, and every state below passes
 * one explicitly. It was hard-coded `"status"` for all three, which meant the engine-unreachable state
 * announced a FAULT through a polite live region: `role="status"` is `aria-live="polite"`, so a screen
 * reader waits for a pause and may never interrupt at all. That flattening contradicted this file's
 * own §5-bis argument two paragraphs up — the whole point of splitting the 404 from the failure is
 * that they differ in urgency, and rendering both at the same urgency to assistive tech gave that
 * argument away for the users who most need it. "Loading" and "no such screen yet" stay `"status"`
 * (ordinary progress and an ordinary product state); only the failure is `"alert"`. */
function EditorNotice({
  title,
  description,
  role,
  action,
}: {
  title: string
  description: string
  /** `"status"` for a state an engineer can act on at leisure, `"alert"` for a fault that must
   * interrupt. No default — a caller adding a fourth state has to decide which it is. */
  role: "status" | "alert"
  /** WS-HMI-2 Task 13 — a way OUT of the state, for the one state that has one. Optional and
   * `undefined` for the rest: a fault an engineer cannot act on must not grow a button that pretends
   * otherwise, and "this route carries no screen id" has nothing to offer either. */
  action?: ReactNode
}) {
  return (
    <div
      role={role}
      data-editor-notice
      className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-border-strong px-6 text-center"
    >
      <h2 className="font-heading text-xl font-semibold text-text-strong">{title}</h2>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      {action}
    </div>
  )
}

export default function EditorRoute() {
  const { screenId } = useParams<{ screenId?: string }>()
  const t = useT()
  const screen = useScreen(screenId)

  /**
   * ── WS-HMI-2 TASK 13 — STARTING A SCREEN THAT DOES NOT EXIST YET ───────────────────────────────
   *
   * The plan's acceptance test was written against a `/editor/new?machine=NEWM-01` route. There is no
   * such route and there is deliberately no new one: `App.tsx` has `/editor/{screenId}`, and Task 8
   * already turned an undeclared screenId into a NAMED not-found state. What that state lacked was a
   * way FORWARD — it told an engineer, correctly, that nothing was there, and stopped. So the
   * not-found state grows one button, and the document it creates takes its identity FROM THE URL.
   *
   * That is the whole reason a `?machine=` form was not added instead: `PUT /v1/screens/{id}` answers
   * 409 when a body and a route name different identities (WS-HMI-0b HIGH-1's rule), and the surest
   * way never to hit that is to have only ONE place the identity can come from.
   *
   * The draft lives HERE, in the route, and NOT in the store — nothing is written until the engineer
   * publishes, so an abandoned "new screen" leaves `GET /v1/screens/{id}` answering exactly the 404 it
   * answered before. It is reset when the URL names a different screen, by React's own documented
   * "adjust state when a prop changes" pattern (the same one `EditorCanvas` and `PropertyPanel` use):
   * `wouter` keeps this component mounted across `/editor/a` → `/editor/b`, so without this an
   * engineer who started a draft for one id and navigated to another would find the first draft
   * sitting under the second id's name.
   *
   * After the first publish this branch stops being reached at all — `usePublishScreen` invalidates
   * `QUERY_KEYS.screen(screenId)`, the refetch answers 200, and the success branch below renders
   * `<EditorCanvas>` with the SERVER's document. The editing session survives that swap rather than
   * restarting, because `EditorCanvas` re-opens a session only when `doc.screenId` CHANGES and this
   * document was born carrying exactly the id the route asked for.
   */
  const [draft, setDraft] = useState<HmiScreenDocument | undefined>(undefined)
  const [draftFor, setDraftFor] = useState<string | undefined>(screenId)
  /**
   * 🔴 FIX ROUND 1 (task-13-review.md HIGH-1) — WHOSE OPERATOR PANEL THIS SCREEN ID IS, if anyone's.
   *
   * `undefined` for every ordinary screen id, which is why nothing appears on this route for one.
   * Non-`undefined` means the button below does not create a screen, it REPLACES a running machine's
   * panel, permanently — the store has no DELETE and rollback cannot reach a document that was never
   * one of this id's versions. An engineer who clicks "start building" had no way to know that before
   * this round; now the state that offers the button also states the cost, and names the machine.
   */
  const shadowed = useShadowedPanel(screenId)
  /**
   * 🔴 WHOLE-BRANCH REVIEW M-1 — IS THIS ID ONE THE WRITE DOOR COULD EVER ACCEPT?
   *
   * `GET /v1/screens/{id}` does not validate an id, it looks one up and answers 404 — so
   * `/editor/Bad_Id` reached the §5-bis not-found state, which since Task 13 carries a "start
   * building this screen" button, and `createBlankScreen` copied the URL segment in verbatim. The
   * engineer then built a whole document and learned at PUBLISH, from a 400. The refusal itself is
   * good — it names the pattern and the offending value — but the identity comes from the URL BY
   * DESIGN ("the surest way never to hit the 409 is to have only ONE place the identity can come
   * from"), so there is no rename surface, no export, and this component's own `draftFor !== screenId`
   * reset discards the draft the moment the URL changes. A session's work, lost to a naming rule
   * nothing surfaced until the end.
   *
   * Refused at the point of ENTRY, where the cost is still zero. `SCREEN_ID_PATTERN` is the mirror
   * `publishedScreen.ts` already holds and `runtime-tests/screenJoin.test.mjs` already checks against
   * the schema file on disk — not a fourth copy of the rule.
   *
   * 🔴 The likeliest typo in the whole feature is exactly this shape: machine codes in this fleet are
   * uppercase with a hyphen, so `/editor/machine-AOI-01` is one keystroke from the id the kiosk
   * actually reads and is illegal under the frozen contract.
   */
  const idIsLegal = screenId !== undefined && SCREEN_ID_PATTERN.test(screenId)
  if (draftFor !== screenId) {
    setDraftFor(screenId)
    setDraft(undefined)
  }

  // wouter cannot match `/editor/:screenId` with an empty segment, so this is unreachable through the
  // router as wired today. Handled anyway rather than asserted away, because the alternative failure is
  // silent and permanent: `useScreen` is `enabled: false` for an empty id, which leaves `isPending`
  // true forever — a spinner that never resolves is exactly the "blank page" §5-bis forbids.
  if (!screenId) {
    return (
      <EditorShell screenId="">
        <EditorNotice role="status" title={t("editor.notDeclared.title")} description={t("editor.notDeclared.noId")} />
      </EditorShell>
    )
  }

  /**
   * 🔴 THE DRAFT BRANCH COMES FIRST, AHEAD OF EVERY QUERY STATE, AND THAT ORDER IS LOAD-BEARING —
   * MEASURED, not chosen for tidiness.
   *
   * The first version of this route put the draft inside the 404 branch, which reads more naturally
   * ("a draft only makes sense for a screen that does not exist"). It cost the engineer their session
   * on the very first publish: `usePublishScreen` invalidates `QUERY_KEYS.screen(screenId)`, and
   * TanStack Query v5 refetching a query that has an ERROR and no DATA clears the error and returns
   * the status to `pending` for the duration of the fetch — so the route rendered the LOADING notice
   * for one commit, `<EditorCanvas>` unmounted, and it came back as a brand-new session. Observed in
   * `tests/43-editor-acceptance.spec.ts`: the publish succeeded (the header's independent version read
   * showed 1, the dirty flag cleared) while the panel's own "published as version 1" line was gone,
   * the selection was gone, and the undo history with it.
   *
   * With the draft first, no query transition can unmount the canvas: the branch is chosen by a piece
   * of state only this component writes. The canvas already OWNS the document from mount
   * (`EditorCanvasProps.doc`), so continuing to hand it the draft object changes nothing about what is
   * being edited — and `EditorShell` is handed `screen.data ?? draft` so the HEADER still reports what
   * the engine holds (title, widget count, current version) the moment the publish lands. Two
   * different questions, answered from two different places, on purpose: what you are editing, and
   * what the server has.
   */
  if (draft) {
    return (
      <EditorShell screenId={screenId} doc={screen.data ?? draft}>
        <EditorCanvas doc={draft} />
      </EditorShell>
    )
  }

  if (screen.isPending) {
    return (
      <EditorShell screenId={screenId}>
        <EditorNotice role="status" title={t("editor.loading.title")} description={t("editor.loading.description")} />
      </EditorShell>
    )
  }

  if (screen.isError) {
    const notDeclared = screen.error instanceof EngineApiError && screen.error.status === 404
    // WS-HMI-2 Task 13 — the button that CREATES a draft is offered only here. An engine that is
    // unreachable is not a screen that does not exist, and offering "start a new one" there would
    // invite an engineer to build a document against a store nobody can currently read or write.
    // (Once a draft exists the branch above answers first, whatever this query then does — see it.)
    return (
      <EditorShell screenId={screenId}>
        {notDeclared ? (
          <EditorNotice
            role="status"
            title={t("editor.notDeclared.title")}
            description={t("editor.notDeclared.description", { screenId })}
            action={
              <>
                {/* 🔴 M-1 — no button at all for an id the write door will always refuse, and the
                    reason names the pattern rather than the outcome. `role="alert"`, because an
                    engineer who reads this and starts anyway loses the session. */}
                {idIsLegal ? null : (
                  <p
                    role="alert"
                    data-editor-illegal-id={screenId}
                    className="max-w-md border border-status-fault bg-status-fault/10 px-3 py-2 text-sm text-danger-text"
                  >
                    {t("editor.notDeclared.illegalId", { screenId, pattern: SCREEN_ID_PATTERN.source })}
                  </p>
                )}
                {/* 🔴 FIX ROUND 1 (HIGH-1) — the cost of the button, stated BEFORE it is pressed and
                    naming the machine. `role="alert"` rather than `status`: an engineer about to
                    replace a running machine's operator panel, irreversibly, must be interrupted —
                    the same split `EditorNotice` already draws between an ordinary product state and
                    a fault. Absent entirely for an ordinary screen id, so nothing cries wolf. */}
                {shadowed ? (
                  <p
                    role="alert"
                    data-editor-shadow-warning={shadowed.machineCode}
                    className="max-w-md border border-status-fault bg-status-fault/10 px-3 py-2 text-sm text-danger-text"
                  >
                    {t("editor.notDeclared.shadowsPanel", { machine: shadowed.machineCode })}
                  </p>
                ) : null}
                {idIsLegal ? (
                <button
                  type="button"
                  data-editor-start-new
                  className="border border-border-strong px-3 py-1.5 text-sm text-text-body hover:border-navy-600 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                  onClick={() => setDraft(createBlankScreen(screenId))}
                >
                  {t("editor.notDeclared.startNew")}
                </button>
                ) : null}
              </>
            }
          />
        ) : (
          // The one `"alert"` on this route. See `EditorNotice`'s own note: an unreachable engine is a
          // fault, not a status, and §5-bis's split between the two states has to survive into the
          // accessibility tree or it only exists for people who can see the words.
          <EditorNotice
            role="alert"
            title={t("common.connectivityError")}
            description={t("editor.loadFailed.description")}
          />
        )}
      </EditorShell>
    )
  }

  return (
    <EditorShell screenId={screenId} doc={screen.data}>
      <EditorCanvas doc={screen.data} />
    </EditorShell>
  )
}
