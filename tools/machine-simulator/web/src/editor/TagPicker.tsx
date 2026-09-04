import type { ComponentModelDocument, ComponentTagDef } from "@/contracts/componentModel"
import type { TagDescriptor } from "@/contracts/tagNamespace"
import { useT } from "@/i18n"
import { useFleetRoster, useMachineComponents, useTagNamespace } from "@/lib/api"
import { POLICY_ACTION_VALUES } from "./editorState"

/**
 * WS-HMI-2 Task 10 — the tag picker: browse a machine's declared namespace and drop a path into the
 * binding field the property panel is editing.
 *
 * ── WHY IT ASKS WHICH MACHINE ────────────────────────────────────────────────────────────────────
 * A screen document is NOT bound to a machine. `contracts/hmi-screen.schema.json` has no machine
 * field and (being frozen) cannot grow one — the same document is meant to be reused across every
 * machine of a class, which is the whole point of `{component}` indirect binding. So the editor
 * cannot infer a machine code, and `GET /v1/tags?machine={code}` needs one. The chooser below is
 * that question asked out loud. It is a `<select>` over the real fleet roster rather than a text box
 * on purpose: a mistyped code answers `200` with an empty document (§5-bis — this endpoint never
 * 404s), so a typo and a machine that has declared nothing would look identical.
 *
 * ── WHAT `isBackedByDriver` IS DOING HERE ────────────────────────────────────────────────────────
 * The brief requires it on screen, and it is the one field on a `TagDescriptor` that tells an
 * engineer whether binding to this path will ever produce a reading: a declared tag with no driver
 * behind it is a legal, valid declaration that answers nothing. Rendered from `=== true`, never from
 * truthiness — a JSON document is not guaranteed to type this field, and "some non-empty value was
 * there" must not read as "a driver is behind it". Same posture, and the same reason, as
 * `policyGate`'s move from truthiness to membership.
 *
 * ── 🔴 S-6: THIS PICKER SELECTS, IT DOES NOT AUTHORISE ───────────────────────────────────────────
 * A `TagDescriptor` with `access: "rw"` carries a `policyAction`, and showing it could be read as
 * "writing here is permitted". It is not, and this file says so in two ways rather than one:
 *
 *   * the value is rendered ONLY when it is a member of the screen contract's frozen vocabulary
 *     (`POLICY_ACTION_VALUES`); anything else renders through `unrecognisedAction`, which names the
 *     offending value and does not present it as a choice. Fail-closed on a value it does not
 *     recognise, exactly as S-6 requires of anything that implies permission;
 *   * the wording is "declares", never "permitted", and `editor.panel.policyNotResolved` states in
 *     the panel's own chrome that nothing here asks the PolicyEngine anything.
 *
 * That is the honest reach. The engine's own gate speaks a DIFFERENT vocabulary
 * (`machine.setpoint.write` / `machine.command.invoke` — `Policy/MachineWriteGate.cs`), disjoint from
 * this one with no translation layer anywhere in the tree, and the web tier cannot see it. Nothing
 * in this file asserts anything about it.
 *
 * ── AND THE ONE LIMIT THAT MUST NOT BE OVERSTATED ────────────────────────────────────────────────
 * A `{component}/leaf` path is substituted by the renderer (`hmi-runtime/bindings.ts`), but no
 * `TagValueSource` in the tree can ANSWER a composed path at runtime today, so such a binding draws
 * the widget's named placeholder. That is a missing adapter, not a missing wire, and
 * `editor.tagPicker.componentNote` says it on screen so nobody reads the insert button as a promise
 * of a live reading.
 */

export type TagPickerProps = {
  /** The machine whose namespace is listed. `""` means "not chosen yet" — a real starting state, not
   * an error; `useTagNamespace` does not fire for it (a blank `?machine=` is a 400 by design). */
  machineCode: string
  onMachineCodeChange: (code: string) => void
  /** The selected widget's `component`, if it declares one. Drives the `{component}/…` section, which
   * is the only place §3.3's indirect binding becomes reachable with a mouse. */
  componentId: string | undefined
  /** The binding this picker is filling in. Always present — the panel mounts the picker per field. */
  bindingName: string
  onInsert: (path: string) => void
  onClose: () => void
}

/** The literal `hmi-runtime/bindings.ts` substitutes at render time. Written here rather than
 * imported because that module keeps it private; the pin that the two agree is behavioural and lives
 * in `tests/39-editor-properties.spec.ts`, which inserts a composed path and then reads the
 * RENDERER's own unresolved-`{component}` warning back off the cell — so a token this file spelled
 * differently would show up as the renderer not recognising it, rather than as a string mismatch. */
const COMPONENT_TOKEN = "{component}"

/** The tags a component instance exposes: its node names a `typeId`, and the type declares the tag
 * names. Returns `undefined` when the id names no node — a stale `component` field on the widget, or
 * simply the wrong machine chosen above; the caller renders those two differently from "no model". */
function componentTagsOf(model: ComponentModelDocument | undefined, componentId: string): readonly ComponentTagDef[] | undefined {
  const node = model?.components.find((candidate) => candidate.id === componentId)
  if (!node) return undefined
  return model?.types.find((type) => type.typeId === node.typeId)?.tags ?? []
}

function isDeclaredPolicyAction(value: unknown): boolean {
  return typeof value === "string" && POLICY_ACTION_VALUES.some((known) => known === value)
}

export function TagPicker({ machineCode, onMachineCodeChange, componentId, bindingName, onInsert, onClose }: TagPickerProps) {
  const t = useT()
  const roster = useFleetRoster()
  const namespace = useTagNamespace(machineCode)
  const components = useMachineComponents(machineCode.length > 0 ? machineCode : undefined)

  const tags: readonly TagDescriptor[] = Array.isArray(namespace.data?.tags) ? namespace.data.tags : []
  const componentTags = componentId === undefined ? undefined : componentTagsOf(components.data, componentId)

  return (
    <div data-tag-picker={bindingName} className="mt-2 border border-border-strong bg-surface-muted p-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-heading text-xs font-semibold text-text-strong">{t("editor.tagPicker.title")}</h4>
        <span className="hmi-micro normal-case">{t("editor.tagPicker.forBinding", { name: bindingName })}</span>
        <button
          type="button"
          data-tag-picker-close
          className="hmi-micro normal-case underline"
          onClick={onClose}
        >
          {t("editor.tagPicker.close")}
        </button>
      </div>

      <label className="mt-2 flex items-center gap-2">
        <span className="hmi-micro w-20 shrink-0">{t("editor.tagPicker.machineLabel")}</span>
        <select
          data-tag-picker-machine
          className="h-7 w-full min-w-0 border border-border-strong bg-surface-subtle px-1.5 text-sm"
          value={machineCode}
          onChange={(event) => onMachineCodeChange(event.target.value)}
        >
          <option value="">{t("editor.tagPicker.machineChoose")}</option>
          {(roster.data?.machines ?? []).map((tile) => (
            <option key={tile.code} value={tile.code}>
              {tile.code}
            </option>
          ))}
        </select>
      </label>

      {machineCode.length === 0 ? (
        <p data-tag-picker-no-machine className="mt-2 text-xs text-text-muted">
          {t("editor.tagPicker.noMachine")}
        </p>
      ) : namespace.isPending ? (
        <p className="mt-2 text-xs text-text-muted">{t("editor.tagPicker.loading")}</p>
      ) : namespace.isError ? (
        // A real fault, not the "declared nothing" state directly below it — the endpoint answers 200
        // with an empty document for a machine nobody has loaded a namespace for, so reaching here
        // means the request itself failed.
        <p data-tag-picker-failed role="alert" className="mt-2 text-xs text-text-muted">
          {t("editor.tagPicker.failed")}
        </p>
      ) : tags.length === 0 ? (
        <p data-tag-picker-empty className="mt-2 text-xs text-text-muted">
          {t("editor.tagPicker.empty", { machine: machineCode })}
        </p>
      ) : (
        <ul data-tag-picker-list className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {tags.map((tag) => {
            // `=== true`, never truthiness — see this file's header.
            const backed = tag.isBackedByDriver === true
            return (
              <li key={tag.path} data-tag-row={tag.path} className="flex items-center gap-2 border border-border-strong px-1.5 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-text-strong">{tag.path}</div>
                  <div className="hmi-micro normal-case text-text-muted">
                    <span data-tag-backed={backed ? "true" : "false"}>
                      {t("editor.tagPicker.backedLabel")}: {backed ? t("editor.tagPicker.backedYes") : t("editor.tagPicker.backedNo")}
                    </span>
                    <span> · {t("editor.tagPicker.accessLabel")}: {String(tag.access)}</span>
                    {tag.policyAction === undefined ? null : isDeclaredPolicyAction(tag.policyAction) ? (
                      <span data-tag-policy="declared"> · {t("editor.tagPicker.declaredAction", { action: String(tag.policyAction) })}</span>
                    ) : (
                      // Fail-closed (S-6): an action outside the frozen vocabulary is NAMED as
                      // unrecognised rather than shown as if it were one of the two real ones.
                      <span data-tag-policy="unrecognised">
                        {" "}
                        · {t("editor.tagPicker.unrecognisedAction", { value: JSON.stringify(tag.policyAction) })}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  data-tag-insert={tag.path}
                  aria-label={t("editor.tagPicker.insert", { path: tag.path })}
                  className="shrink-0 border border-border-strong px-1.5 py-0.5 text-xs"
                  onClick={() => onInsert(tag.path)}
                >
                  +
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── the {component}/… half — §3.3 with a mouse ────────────────────────────────────────── */}
      <div data-tag-picker-component-section className="mt-3 border-t border-border-strong pt-2">
        {componentId === undefined ? (
          <p data-tag-picker-component-none className="text-xs text-text-muted">
            {t("editor.tagPicker.componentNoneOnWidget")}
          </p>
        ) : (
          <>
            <h5 className="hmi-micro normal-case text-text-strong">
              {t("editor.tagPicker.componentSection", { component: componentId })}
            </h5>
            {componentTags === undefined ? (
              components.data === undefined ? (
                <p data-tag-picker-component-nomodel className="mt-1 text-xs text-text-muted">
                  {t("editor.tagPicker.componentNoModel")}
                </p>
              ) : (
                <p data-tag-picker-component-unknown className="mt-1 text-xs text-text-muted">
                  {t("editor.tagPicker.componentUnknown", { component: componentId })}
                </p>
              )
            ) : (
              <ul data-tag-picker-component-list className="mt-1 flex flex-col gap-1">
                {componentTags.map((tag) => {
                  const composed = `${COMPONENT_TOKEN}/${tag.name}`
                  return (
                    <li key={tag.name} className="flex items-center gap-2 border border-border-strong px-1.5 py-1">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-strong">{composed}</span>
                      <button
                        type="button"
                        data-tag-component-insert={tag.name}
                        aria-label={t("editor.tagPicker.insert", { path: composed })}
                        className="shrink-0 border border-border-strong px-1.5 py-0.5 text-xs"
                        onClick={() => onInsert(composed)}
                      >
                        +
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {/* Not a footnote: the composed path does not resolve to a reading anywhere in this tree
                yet, and an insert button with no such sentence beside it reads as a promise. */}
            <p data-tag-picker-component-note className="mt-1 text-xs text-text-muted">
              {t("editor.tagPicker.componentNote")}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
