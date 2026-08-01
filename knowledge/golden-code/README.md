# Golden-code library — few-shot corpus for the Automation Programming Copilot

> **Doc 34 (P1) deliverable.** See
> `docs/ECOSYSTEM/34_AI_LOCAL_AUTOMATION_PROGRAMMING_COPILOT_DESIGN_AND_UPGRADE_PLAN_2026-07.md`
> §III.3(d) *golden-code library*, §11.2 *few-shot priming*, and §VI-bis *D7 tiers*.

## Purpose

This is the **few-shot corpus** the copilot retrieves to *prime* correct syntax and house
conventions **per language**, before it generates. Each example is a short, correct, minimal-but
-representative program that a real engineer would accept — and, for Tier A, one that would
plausibly pass the platform's `programmingAdapter.validate()` (and, for `ir-flow`, the safety
linter + sim gate) for its `kind`. Retrieval selects a few examples matching the target
language/task and inserts them into the system prompt as worked references. The library is
**versioned in Git** so contributions are reviewable.

## Structure

```
knowledge/golden-code/
  README.md                 <- this file
  index.json                <- machine-readable index (array; see shape below)
  <lang>/                   <- one folder per language / adapter kind
    <name>.<ext>            <- the code file (safety header + inline comments)
    <name>.meta.md          <- task prompt (vi+en) -> the code + convention notes
```

Every Tier A example is a **pair**: the code file + a sibling `<name>.meta.md`. Tier B folders
carry only a `README.md` stub (no code yet).

## How examples are keyed / retrieved

`index.json` is a flat JSON **array**; each entry:

```json
{
  "id":    "iec61131-st/moving-average",   // stable unique key (== folder/name)
  "lang":  "iec61131-st",                   // language family label
  "title": "N-sample moving average (ring buffer)",
  "task":  "Smooth a noisy analog reading ...",   // one-line intent for matching
  "file":  "iec61131-st/moving-average.st", // path relative to this folder
  "kind":  "iec61131-st",                   // programmingAdapter kind (null for Tier B)
  "tier":  "A",                             // "A" (has substrate) | "B" (RAG-first)
  "tags":  ["structured-text", "filter", "..."]
}
```

- **Retrieval** matches a user task against `task` + `tags` + `lang`, pulls the top-k `file`s,
  and injects each `code` (optionally with its `.meta.md` notes) as a few-shot example.
- **Validation line-up**: because `kind` maps 1:1 onto a `programmingAdapter` kind, a retrieved
  example (and any code the copilot then generates *for that kind*) can be run back through
  `programmingRegistry.getAdapter(kind).validate()` — the golden example and the generated
  output are checked by the **same** validator. (`urscript` is the one exception — see below.)

### `kind` values (must match `programmingAdapter`)

`iec61131-st` · `iec61131-ld` · `iec61131-pou` · `ir-flow` · `zmotion-basic` ·
`mitsubishi-engineering` · `robot-tm` · `urscript`.

> **`urscript` caveat**: there is **no** `urscript` adapter in `programmingRegistry`. URScript is
> the transpile **output** of `ir-flow` (`transpileToUrscript`) and is validated **indirectly**
> on a virtual URSim controller (the HIL gate). Its golden example primes the *target dialect*;
> author as `ir-flow` to get the full linter → sim → HIL chain.

## Tier A vs Tier B (D7)

- **Tier A — has authoring substrate (codegen + validate/sim now).** IEC 61131-3 ST / LD (/ POU),
  `ir-flow` → URScript/ROS2 (strongest: safety-linter → kinematic sim gate → Rapier → HIL URSim),
  Zmotion ZBasic, Mitsubishi MELSEC device/recipe, Techman `robot-tm`. **Seeded here now.**
- **Tier B — RAG-first, no sim substrate yet.** Fanuc KAREL/TP, Mitsubishi MELFA, ABB RAPID,
  Delta robot. These get a folder `README.md` stub only; real examples land **after** P1
  vendor-manual ingestion yields cited, verified snippets. Do **not** treat generated Tier B code
  as validate-passed.

## THE SAFETY RULE (non-negotiable — applies to every file here)

- **No safety-function examples.** This library never contains E-stop, protective-stop,
  interlock, light-curtain, safety-plane, DCS/SafeMove, or SIL logic. Those stay on the certified
  safety controller / relay and are **out of scope** for AI-authored code. The copilot must
  **refuse** to generate them.
- Every example authors **process/motion logic only** and carries a **safety header comment**
  (a `_safety_note` JSON field for `ir-flow`, since JSON has no comments).
- **AI assists; the engineer decides & tests.** Every example is reviewed, validated, simulated,
  and (where hardware is involved) HITL-approved before it could ever reach a device. Nothing
  here auto-deploys.

## Contribution convention

1. Put the code file under `<lang>/<name>.<ext>` and a sibling `<name>.meta.md`.
2. `.meta.md` carries: the **task prompt in vi + en**, why it is correct / what it demonstrates,
   and **internal convention notes** (naming, adapter-reality gotchas).
3. Add the **safety header** to the code file (or `_safety_note` for JSON).
4. Verify it **passes `programmingAdapter.validate()` for its `kind`** (Tier A). Keep it
   **short and correct** over comprehensive.
5. Register it in `index.json` (`id` == `<lang>/<name>`; fill `kind`, `tier`, `tags`).
6. Language-specific validator gotchas to respect:
   - **ST**: `validate()` balances `VAR/IF/FOR/WHILE` (+`END_…`) **case-insensitively over the
     whole file, comments included** — avoid the bare words *if/for/while/var* in comments.
   - **LD**: one rung per line `OUT := <bool expr>`; grammar is identifiers + `AND OR NOT XOR` +
     parens + `TRUE/FALSE` only (**no numbers/comparisons**). Comments are stripped **per line**
     — use `//` for multi-line notes (a multi-line `(* … *)` breaks the parser).
   - **ir-flow**: keep within the ISO/TS 15066 ceilings (speed ≤ 250 mm/s, force ≤ 150 N, blend ≤
     100 mm, poses inside the workspace AABB) or the safety linter blocks codegen. `signal`/
     `signal_ref` are **strings**.
   - **zmotion-basic**: block-open/close balance is by **line count**; include ≥1 motion op
     (`MOVE/MOVEABS/…`). Comments use `'`.
   - **mitsubishi-engineering**: `<DEVICE> = <value>` per line; device prefix ∈
     `X Y M L F B V S T C D W R Z`, decimal address (X/Y/B/W may be hex). Comments use `'`.
   - **robot-tm**: define `POINT <name> = (…)` before referencing it; verbs ∈
     `HOME/MOVE/MOVEL/PICK/PLACE/GRIP/RELEASE/WAIT`. Comments use `'`.
