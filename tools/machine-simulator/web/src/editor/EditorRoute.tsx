import type { ReactNode } from "react"
import { useParams } from "wouter"

import type { HmiScreenDocument } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import { EngineApiError, useScreen } from "@/lib/api"
import { EditorCanvas } from "./EditorCanvas"

/**
 * WS-HMI-2 Task 8 — `/editor/:screenId`, the screen builder's shell.
 *
 * Mounted from `App.tsx`'s top-level `<Switch>`, OUTSIDE `<Shell>` — the same placement `/tokens` and
 * the two `/hmi/*` routes already use, and for the same reason: the sidebar/topbar chrome would eat
 * the width a design canvas needs, and nothing about this route belongs to the app's own navigation
 * model yet. Still behind `<AuthGate>` like every other route, because `GET /v1/screens/{screenId}`
 * sits behind the backend's default-deny fallback policy (Operator to read, Engineer to write).
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
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-surface-subtle text-text-body">
      <header className="flex shrink-0 flex-col gap-1 border-b border-border-strong px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-heading text-lg font-semibold text-text-strong">{t("editor.title")}</h1>
          <span className="hmi-micro">{t("editor.titleGloss")}</span>
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
 * them is the words, and a second component is a second place to forget the heading. */
function EditorNotice({ title, description }: { title: string; description: string }) {
  return (
    <div
      role="status"
      data-editor-notice
      className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-border-strong px-6 text-center"
    >
      <h2 className="font-heading text-xl font-semibold text-text-strong">{title}</h2>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
    </div>
  )
}

export default function EditorRoute() {
  const { screenId } = useParams<{ screenId?: string }>()
  const t = useT()
  const screen = useScreen(screenId)

  // wouter cannot match `/editor/:screenId` with an empty segment, so this is unreachable through the
  // router as wired today. Handled anyway rather than asserted away, because the alternative failure is
  // silent and permanent: `useScreen` is `enabled: false` for an empty id, which leaves `isPending`
  // true forever — a spinner that never resolves is exactly the "blank page" §5-bis forbids.
  if (!screenId) {
    return (
      <EditorShell screenId="">
        <EditorNotice title={t("editor.notDeclared.title")} description={t("editor.notDeclared.noId")} />
      </EditorShell>
    )
  }

  if (screen.isPending) {
    return (
      <EditorShell screenId={screenId}>
        <EditorNotice title={t("editor.loading.title")} description={t("editor.loading.description")} />
      </EditorShell>
    )
  }

  if (screen.isError) {
    const notDeclared = screen.error instanceof EngineApiError && screen.error.status === 404
    return (
      <EditorShell screenId={screenId}>
        {notDeclared ? (
          <EditorNotice
            title={t("editor.notDeclared.title")}
            description={t("editor.notDeclared.description", { screenId })}
          />
        ) : (
          <EditorNotice title={t("common.connectivityError")} description={t("editor.loadFailed.description")} />
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
