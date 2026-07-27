/**
 * Doc 69 · Wave 4 / C1 — CodeMirror 6 INLINE GHOST-TEXT extension.
 *
 * The CodeMirror-specific wiring that drives InlineCopilotController (see
 * ./inlineCopilotController.ts for the pure debounce/race-safety engine, which is what carries
 * the unit test coverage). This file is thin by design:
 *   - a StateField holding the current ghost suggestion ({text, pos} | null), cleared by ANY
 *     doc change or selection change (unless the SAME transaction sets a fresh one),
 *   - a decoration (derived via EditorView.decorations.compute, no second StateField needed)
 *     rendering the suggestion as dimmed, `aria-hidden` ghost text right after the cursor,
 *   - an update listener that re-schedules a request on every doc/selection change,
 *   - a Prec.highest keymap: Tab inserts the suggestion (only when one is showing — otherwise
 *     falls through to whatever Tab already does, unchanged), Esc dismisses it.
 *
 * package.json has NO existing ghost-text/inline-completion CodeMirror package (grepped;
 * `@codemirror/autocomplete` is present only transitively via @uiw/react-codemirror's
 * basicSetup and offers a POPUP completion list, not inline ghost text) — this is a minimal
 * custom extension built from the already-installed `@codemirror/state` / `@codemirror/view`,
 * per the brief's guidance to avoid a new dependency when nothing suitable already exists.
 *
 * Accessible name: this extension ONLY adds a decoration + listeners + a keymap — it never
 * touches `EditorView.contentAttributes` (that's where CodeEditor.tsx sets `aria-label`, see
 * its extensions useMemo), so it cannot clobber the editor surface's accessible name (the past
 * bug this repo has hit before). The ghost widget itself is `aria-hidden="true"` and
 * `pointer-events: none` — decorative only, never announced, never intercepts clicks.
 */
import { StateEffect, StateField, Prec, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import {
  InlineCopilotController,
  type FetchInlineCompletion,
  type InlineCopilotControllerOptions,
} from "./inlineCopilotController";

interface GhostSuggestion {
  text: string;
  pos: number;
}

/** Set (or clear, with `null`) the current ghost suggestion. */
const setGhost = StateEffect.define<GhostSuggestion | null>();

/**
 * The suggestion currently shown (or null). Cleared by ANY doc change or selection move
 * (the "any edit invalidates it" requirement) UNLESS that same transaction also carries a
 * `setGhost` effect (our own accept/dismiss/set dispatches), in which case the effect wins.
 */
const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhost)) return e.value;
    }
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
});

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.className = "cm-inline-copilot-ghost";
    // Dimmed ghost text, decorative only — see module header re: accessible-name safety.
    span.style.opacity = "0.45";
    span.style.fontStyle = "italic";
    span.style.pointerEvents = "none";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/** Derive the decoration straight from ghostField's value — no second StateField needed. */
const ghostDecorations = EditorView.decorations.compute([ghostField], (state) => {
  const ghost = state.field(ghostField);
  if (!ghost || !ghost.text) return Decoration.none;
  const pos = Math.min(Math.max(0, ghost.pos), state.doc.length);
  return Decoration.set([Decoration.widget({ widget: new GhostTextWidget(ghost.text), side: 1 }).range(pos)]);
});

export interface InlineCopilotExtensionOptions extends InlineCopilotControllerOptions {
  /** Fetch a completion for a bounded {prefix,suffix} window. Fail-safe: reject/`""` → no ghost text. */
  fetchCompletion: FetchInlineCompletion;
}

/**
 * Build the opt-in inline ghost-text extension. Returns a plain array of CodeMirror
 * `Extension`s — additive, does not replace or reconfigure anything else CodeEditor.tsx adds.
 */
export function inlineCopilotExtension(options: InlineCopilotExtensionOptions): Extension {
  const { fetchCompletion, ...controllerOptions } = options;
  const controller = new InlineCopilotController(fetchCompletion, controllerOptions);

  const requestOnChange = EditorView.updateListener.of((update) => {
    // Our OWN dispatches (set-ghost / accept / dismiss) either carry no doc/selection change
    // (set/dismiss) — skip, avoiding a request loop — or DO change the doc (accept), which
    // legitimately should schedule a fresh request for what comes next.
    if (!update.docChanged && !update.selectionSet) return;
    // `EditorState.readOnly` is ADVISORY in CodeMirror 6 (it does not itself block dispatch) —
    // ghost text/Tab-insert is meaningless on a read-only buffer, so this extension enforces
    // it itself: never request or show a suggestion once the state is read-only.
    if (update.state.readOnly) return;
    const view = update.view;
    const cursor = view.state.selection.main.head;
    const docText = view.state.doc.toString();
    controller.schedule(
      { docText, cursor },
      () => ({ docText: view.state.doc.toString(), cursor: view.state.selection.main.head }),
      (completion) => {
        if (!completion) return; // fail-safe empty (flag off / model absent / error) → show nothing
        view.dispatch({ effects: setGhost.of({ text: completion, pos: cursor }) });
      },
    );
  });

  const acceptDismissKeymap = Prec.highest(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const ghost = view.state.field(ghostField);
          if (!ghost || !ghost.text) return false; // no suggestion showing → let Tab do whatever it already does
          if (view.state.readOnly) return false; // never insert into a read-only buffer (advisory facet — enforce here)
          view.dispatch({
            changes: { from: ghost.pos, to: ghost.pos, insert: ghost.text },
            selection: { anchor: ghost.pos + ghost.text.length },
            effects: setGhost.of(null),
          });
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          const ghost = view.state.field(ghostField);
          if (!ghost) return false;
          view.dispatch({ effects: setGhost.of(null) });
          return true;
        },
      },
    ]),
  );

  return [ghostField, ghostDecorations, requestOnChange, acceptDismissKeymap];
}
