import type { HmiScreenDocument } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import {
  EngineApiError,
  useRollbackScreen,
  usePublishScreen,
  useScreenVersions,
  type PutScreenResult,
  type ScreenVersionInfo,
} from "@/lib/api"

/**
 * WS-HMI-2 Task 12 — PUBLISH, VERSION HISTORY, PREVIEW AN OLD VERSION, ROLLBACK.
 *
 * ── WHY THIS FILE EXISTS WHEN THE BRIEF NAMED ONE NEW COMPONENT ──────────────────────────────────
 * The brief's file list names `BreakpointPreview.tsx`. A component called `BreakpointPreview` that
 * also published documents and rolled the store back would be a name that lies, and the next reader
 * would pay for it. So the breakpoint frame is that file, and this is a second one. Nothing else was
 * added: the route, the canvas, `lib/hmiScreens.ts` and `lib/api.ts` are the modifications the brief
 * names.
 *
 * ── 🔴 EVERY REFUSAL LANDS ON THE CONTROL THAT CAUSED IT ─────────────────────────────────────────
 * The standing lesson of this workstream, twice over. Task 10 shipped a number box that, emptied,
 * silently wrote a zero; Task 11 shipped a rename that was refused while the rejected name stayed in
 * the field. Publishing has more ways to be refused than either of them —
 *
 *   * **400** — `ContractInvariants` rejected the document. Its message carries EVERY violation, not
 *     the first (`ContractViolationException`'s own constructor joins them with `" | "`), and this
 *     panel renders every one of them as its own line. WS-HMI-2 Task 12 also made that door strictly
 *     tighter on the server: a `widget.kind` outside the frozen enum and a `widget.id` that breaks the
 *     frozen pattern are now refusals rather than stored documents, so a 400 here is reachable from
 *     more than §5.
 *   * **409** — the body's `screenId` names a different screen from the route. The engine refuses
 *     rather than silently choosing one of the two identities, and says which two.
 *   * **503** — another writer holds the store's write lock. The request was well-formed and would
 *     likely succeed on retry, and the message says so; this is the one refusal that is not the
 *     engineer's to fix.
 *   * **404**, on rollback only — the version asked for does not exist (or the screen does not).
 *   * **401/403** — this session is not an Engineer. `request<T>`'s app-wide 401 handler already
 *     bounces to Login; a 403 stops here and is named.
 *
 * All of them render into the SAME `role="alert"` block, immediately under the button that produced
 * them, carrying the HTTP status as data so a reader (and the spec) can tell which door said no. None
 * of them goes only to the console.
 *
 * ── 🔴 PREVIEWING AN OLD VERSION IS NOT PUBLISHING, AND NOT LOADING ──────────────────────────────
 * Choosing a version fetches `GET /v1/screens/{id}?version=N` and hands it UP to `EditorCanvas`,
 * which draws it read-only in place of the session's document. The session itself — its widgets, its
 * undo stack, its unsaved edits — is untouched and comes straight back when the preview is closed.
 * That is the only safe meaning of "look at version 3": an editor that loaded it INTO the session
 * would discard whatever the engineer had not published, which is the thing this task was told to
 * treat as user data.
 *
 * ── 🔴 ROLLBACK APPENDS, AND THIS PANEL SAYS SO RATHER THAN GUESSING ─────────────────────────────
 * `POST .../rollback` re-publishes an old document as a NEW, higher version; the history never loses
 * an entry and the pointer never moves backwards. Two consequences this panel is careful about:
 *
 *   * the number it reports is the NEW version the call returned, never the `toVersion` asked for;
 *   * it does NOT reload the canvas from the restored document. A rollback is a server-side move, and
 *     an editor that answered it by overwriting an open session would destroy unsaved work as a side
 *     effect of a button labelled "restore". The panel says what happened and leaves the session
 *     alone.
 */
export function PublishPanel({
  screenId,
  doc,
  dirty,
  overtaken,
  previewVersion,
  onPreviewVersion,
  onPublished,
}: {
  screenId: string
  /** The document as edited — what `Publish` sends. Read at click time, never cached here. */
  doc: HmiScreenDocument
  /** Whether the session differs from what the server last accepted. Computed by `EditorCanvas` (it
   * owns the baseline); shown here because this is where the answer to "so publish it" lives. */
  dirty: boolean
  /**
   * Set by `EditorCanvas` when a publish landed FURTHER than one step past the version this session
   * last stood on — i.e. somebody else published in between. `undefined` otherwise.
   *
   * 🔴 IT IS AN AFTER-THE-FACT NOTICE AND SAYS SO, because a before-the-fact one is not available
   * honestly. `useScreenVersions` does not poll — it reads a DECLARATION a human writes, and a 1 s
   * poll for it would be ~86 000 requests a day — so between opening the editor and pressing Publish
   * there is no moment at which this client learns that the head moved. What it CAN do, exactly and
   * without guessing, is compare the version the engine just returned with the version this session
   * expected: land at 7 having stood on 3 and versions 4-6 came from somewhere else. Nothing was
   * overwritten (the store appends), but this document does not carry those changes, and that is the
   * thing an engineer must be told rather than left to discover.
   */
  overtaken: { landedAs: number; openedFrom: number } | undefined
  previewVersion: number | undefined
  onPreviewVersion: (version: number | undefined) => void
  /** Called with the exact document the engine accepted and the version it produced, so the canvas
   * can move its dirty baseline onto it. Passing the document back rather than letting the canvas
   * re-read its own state closes a real window: the engineer can keep typing while the PUT is in
   * flight, and a baseline set from "whatever the state is now" would mark those keystrokes as
   * already-published. */
  onPublished: (published: HmiScreenDocument, version: number) => void
}) {
  const t = useT()
  const versions = useScreenVersions(screenId)
  const publish = usePublishScreen(screenId)
  const rollback = useRollbackScreen(screenId)

  const rows: ScreenVersionInfo[] = versions.data ?? []

  return (
    // 🔴 `w-full`, and it sits UNDER `PropertyPanel` inside the existing right rail rather than as a
    // fourth column. Measured reasoning, not taste: `38-editor-drag.spec.ts` runs a deliberately narrow
    // 900x620 pass, and a fourth 224 px rail would have left the canvas frame around 40 px wide there —
    // twelve `minmax(0, 1fr)` tracks behind 88 px of gutters, i.e. zero-width cells and a drag pitch of
    // zero. Stacking costs the canvas nothing horizontally, so that spec's frozen overlay-alignment
    // measurement keeps the exact frame it had before this task.
    <aside
      data-publish-panel
      className="flex w-full shrink-0 flex-col gap-2 border border-border-strong bg-surface-muted p-2"
    >
      <h2 className="font-heading text-sm font-semibold text-text-strong">{t("editor.publish.title")}</h2>

      {/* ── the state of the session, before any button ────────────────────────────────────────── */}
      <p data-editor-dirty={dirty ? "true" : "false"} className="hmi-micro normal-case text-text-muted">
        {dirty ? t("editor.publish.unsaved") : t("editor.publish.saved")}
      </p>

      <button
        type="button"
        data-publish-button
        disabled={publish.isPending}
        className="border border-border-strong bg-surface-subtle px-2 py-1 text-sm text-text-strong disabled:opacity-50"
        onClick={() => {
          // The document is snapshotted HERE, at click time, and the same snapshot is what
          // `onPublished` reports back — see that prop's own note.
          const sent = doc
          publish.mutate(sent, {
            onSuccess: (result: PutScreenResult) => onPublished(sent, result.version),
          })
        }}
      >
        {publish.isPending ? t("editor.publish.pending") : t("editor.publish.action")}
      </button>

      {publish.isSuccess && !publish.isPending ? (
        <p
          data-publish-version={publish.data.version}
          role="status"
          className="border border-border-strong bg-surface-subtle px-1.5 py-1 text-xs text-text-strong"
        >
          {t("editor.publish.published", { version: publish.data.version })}
        </p>
      ) : null}

      <Refusal what="publish" error={publish.error} />

      {overtaken ? (
        <p
          data-publish-overtaken={overtaken.landedAs}
          role="status"
          className="border border-border-strong bg-surface-subtle px-1.5 py-1 text-xs text-text-body"
        >
          {t("editor.publish.overtaken", { landedAs: overtaken.landedAs, openedFrom: overtaken.openedFrom })}
        </p>
      ) : null}

      {/* ── the history ───────────────────────────────────────────────────────────────────────── */}
      <h3 className="hmi-micro">{t("editor.publish.historyTitle")}</h3>
      {versions.isPending ? <p className="text-xs text-text-muted">{t("editor.publish.historyLoading")}</p> : null}
      {versions.isError ? (
        <p role="alert" className="text-xs text-text-body">
          {t("editor.publish.historyFailed")}
        </p>
      ) : null}
      {!versions.isPending && !versions.isError && rows.length === 0 ? (
        <p data-publish-history-empty className="text-xs text-text-muted">
          {t("editor.publish.historyEmpty")}
        </p>
      ) : null}

      <ul data-publish-history className="flex flex-col gap-1">
        {/* Newest first — the list is read top-down and the head is the row an engineer looks for.
            `slice()` because `versions.data` is React Query's cached array and `sort` mutates. */}
        {rows
          .slice()
          .sort((a, b) => b.version - a.version)
          .map((row) => (
            <li
              key={row.version}
              data-publish-version-row={row.version}
              data-publish-version-current={row.isCurrent ? "true" : "false"}
              className="flex flex-col gap-0.5 border border-border-strong bg-surface-subtle px-1.5 py-1"
            >
              <span className="text-xs text-text-strong">
                {t("editor.publish.versionRow", { version: row.version })}
                {row.isCurrent ? ` — ${t("editor.publish.current")}` : ""}
              </span>
              <span className="hmi-micro normal-case text-text-muted">{row.savedAtUtc}</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  data-publish-preview={row.version}
                  className="border border-border-strong px-1 text-xs text-text-body"
                  onClick={() => onPreviewVersion(previewVersion === row.version ? undefined : row.version)}
                >
                  {previewVersion === row.version
                    ? t("editor.publish.previewClose")
                    : t("editor.publish.preview")}
                </button>
                <button
                  type="button"
                  data-publish-rollback={row.version}
                  // Rolling back TO the current version would append an identical copy — legal at the
                  // store, meaningless to a person, and it would make the history grow with rows that
                  // record nothing. Disabled with a named reason rather than hidden, so the row's two
                  // buttons stay in the same place on every row.
                  disabled={row.isCurrent || rollback.isPending}
                  title={row.isCurrent ? t("editor.publish.rollbackIsCurrent") : undefined}
                  className="border border-border-strong px-1 text-xs text-text-body disabled:opacity-40"
                  onClick={() => rollback.mutate(row.version)}
                >
                  {t("editor.publish.rollback")}
                </button>
              </span>
            </li>
          ))}
      </ul>

      {rollback.isSuccess && !rollback.isPending ? (
        <p
          data-rollback-version={rollback.data.version}
          role="status"
          className="border border-border-strong bg-surface-subtle px-1.5 py-1 text-xs text-text-strong"
        >
          {t("editor.publish.rolledBack", { version: rollback.data.version })}
        </p>
      ) : null}

      <Refusal what="rollback" error={rollback.error} />
    </aside>
  )
}

/**
 * The one refusal surface both mutations render into.
 *
 * 🔴 IT SPLITS ON `" | "` AND THAT IS LOSSLESS, NOT A PARSE. `ContractViolationException`'s message is
 * `"…(N): first | second | third"`, joined by that exact separator in its own constructor. Splitting
 * and re-rendering each part puts every violation on its own line — an engineer fixing three of them
 * should not have to read a run-on sentence — and because split-then-render drops nothing, a message
 * that happens to contain no separator renders as one line, unchanged. Nothing here decides which
 * violations matter; all of them are shown.
 *
 * A non-`EngineApiError` (a network failure, an abort) has no status and no server text, so it renders
 * the generic connectivity sentence rather than an empty box.
 */
function Refusal({ what, error }: { what: "publish" | "rollback"; error: Error | null }) {
  const t = useT()
  if (!error) return null

  const api = error instanceof EngineApiError ? error : undefined
  const lines = api?.serverMessage ? api.serverMessage.split(" | ") : []

  return (
    <div
      role="alert"
      data-publish-error={what}
      data-publish-status={api?.status ?? ""}
      className="flex flex-col gap-1 border border-border-strong bg-surface-subtle px-1.5 py-1 text-xs text-text-body"
    >
      <span className="font-semibold text-text-strong">
        {t(what === "publish" ? "editor.publish.refused" : "editor.publish.rollbackRefused", {
          status: api?.status ?? 0,
        })}
      </span>
      {/* The status, in words, so the reader is told what KIND of no this is before they read the
          engine's own sentence. Every branch below is a status this route can actually answer. */}
      <span>
        {api?.status === 400
          ? t("editor.publish.reason400")
          : api?.status === 409
            ? t("editor.publish.reason409")
            : api?.status === 503
              ? t("editor.publish.reason503")
              : api?.status === 404
                ? t("editor.publish.reason404")
                : api?.status === 403
                  ? t("editor.publish.reason403")
                  : t("common.connectivityError")}
      </span>
      {lines.length > 0 ? (
        <ul data-publish-violations={lines.length} className="flex list-disc flex-col gap-0.5 pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
