# 72 — Enabling Programming-KB Grounding (`PROG_KB_ENABLED`) + PROVEN-LIVE Runbook

**doc69 Wave 4 (C3), 2026-07-27.** Scope: **CODE (light) + RUNBOOK**. Grounding + citations are ALREADY
built and wired (doc 34 · P1/P2) — this task does not rebuild them. It adds one focused test that pins the
citation-flow contract, and this runbook: the ops procedure to run the live smoke, flip `PROG_KB_ENABLED=true`,
and record a PROVEN-LIVE artifact. **`PROG_KB_ENABLED`'s CODE default stays `false`** — no live model/KB was
run to produce this doc; the flag flip described in §7 is the operator's action, done AFTER the smoke passes,
on the ops box, not a change to the code's fallback default.

---

## 1. Two separate switches — do not confuse them

| | `AI_PROGRAMMING_COPILOT_ENABLED` | `PROG_KB_ENABLED` |
|---|---|---|
| What it gates | The whole Automation Programming Copilot (`suggestProgram`, `generateProgram`, `explainProgram` — `server/services/programming/aiProgrammingCopilot.ts:60-65`) | Just the RAG **grounding** layer underneath codegen (`aiProgrammingKnowledgeService.ts:172-174`) |
| Default | OFF (unset / not `"true"`/`"1"`) | OFF (`(process.env.PROG_KB_ENABLED ?? "false").toLowerCase() === "true"`) |
| Off behavior | `generateProgram()` returns `{ ok:false, refused:false, note:"AI_PROGRAMMING_COPILOT_ENABLED is off." }` — no model load, no KB call at all | `searchProgrammingKb()` returns a well-formed empty result `{ enabled:false, answerContext:"", citations:[], chunks:[] }` (`aiProgrammingKnowledgeService.ts:489/502`) — codegen still runs, just ungrounded |
| Relationship | **Independent, intentional switches.** Copilot-enabled with KB disabled is a valid, supported state — codegen still runs off golden few-shot examples + the model's own knowledge, just without cited vendor-manual context. KB-enabled with copilot disabled is inert (nothing calls `searchProgrammingKb` outside the copilot and this eval harness). | |

This runbook is about the **second** switch. It assumes the first (`AI_PROGRAMMING_COPILOT_ENABLED`) is
already on — see doc 34 for that rollout; this doc doesn't repeat it.

## 2. What already exists (STEP 0 findings — do not rebuild)

- **`server/services/aiProgrammingKnowledgeService.ts`** — the retrieval service. `isEnabled()`
  (~:172-174) is the master gate, `PROG_KB_ENABLED` default `false`. `searchProgrammingKb()`
  (~:497-608): gate off → `emptyResult()` (~:488-490, `enabled:false, citations:[], answerContext:""`,
  no disk read); gate on → loads `knowledge/programming/<vendorSlug>/{chunks,embeddings}.jsonl` +
  `manifest.json`, hybrid semantic(0.72)/keyword(0.28) scoring, optional reranker, and returns
  page-cited `citations: ProgKbCitation[]` (`{id, vendor, docTitle, page, section, sourcePath, score}`)
  plus an assembled, numbered `answerContext` string the LLM prompt is grounded on (~:576-607).
- **`server/services/programming/aiProgrammingCopilot.ts`** — `retrieveContext()` (~:477-494) calls
  `searchProgrammingKb` fail-safe (any error → empty context, never throws) and maps citations into the
  copilot's own `GenCitation` shape (`{vendor, docTitle, page}`). `generateProgram()` (~:585-711) calls it
  at ~:618-620 — "Ground with cited RAG — attach citations to EVERY result (even when empty)" — for every
  `generate`/`complete`/`translate`/`explain`/`review` call, gated + fail-safe regardless of
  `PROG_KB_ENABLED`'s value.
- **`scripts/ai-eval/eval-rag-programming.mjs`** — the existing retrieval-only smoke/eval harness (§4).
  **`scripts/ai-eval/eval-codegen.mjs`** — the existing codegen eval that also reports `avgCitations` per
  case, i.e. the harness that shows citations flowing all the way into a real `generateProgram()` result (§5).
- **Test coverage confirmed / added (this task):**
  - `server/services/aiProgrammingKnowledgeService.test.ts` already asserts the KB service's own
    `PROG_KB_ENABLED` on/off contract directly (fixture corpus, real `isEnabled()`/`searchProgrammingKb`,
    no mocking of the service under test): citation shape (page/docTitle/vendor/sourcePath), and
    `"PROG_KB_ENABLED=off → empty, well-formed result (no crash)"` (~:177-186).
  - `server/services/programming/aiProgrammingCopilot.test.ts` already had
    `"attaches RAG citations from searchProgrammingKb (grounded, not fabricated)"` (~:211-225) proving the
    **enabled** side of the end-to-end flow: a KB result with citations propagates into
    `generateProgram()`'s `result.citations`. It did **not** have an explicit assertion for the disabled
    side at the copilot layer (every other test relies on the shared top-of-file mock returning
    `{enabled:false, citations:[]}` implicitly, never asserted). This task adds one companion test,
    `"PROG_KB_ENABLED=false (KB disabled) → citations empty, result still well-formed (no crash)"`, right
    after it, closing that gap without duplicating the existing "enabled" case. See §6 for the run output.

## 3. Prerequisites (all separate, all verifiable before touching the flag)

1. **Copilot enabled.** `AI_PROGRAMMING_COPILOT_ENABLED=true` in the API process env (see §1). Without
   this, `generateProgram()` returns the disabled result before it ever calls the KB — grounding would
   have nothing to attach to.
2. **KB corpus ingested.** `knowledge/programming/<vendorSlug>/chunks.jsonl` + `manifest.json` must exist.
   Produced by `node scripts/ai-kb/ingest-manuals.mjs` (reads vendor PDF manuals from
   `PROG_KB_MANUALS_DIR`, default `D:/SOURCES/AI Local/Manual`, one subfolder per vendor). **This is a
   DIFFERENT corpus from the ops/quality KB `npm run kb:sync` builds** — `kb:sync` runs
   `extract-codebase-knowledge` / `build-operational-cards` / `build-knowledge-chunks` /
   `embed-incremental` / `build-semantic-graph`, none of which touch `knowledge/programming/` (verified:
   only `ingest-manuals.mjs` and `embed-programming.mjs` read/write that directory). Do not run `kb:sync`
   expecting it to populate the programming corpus — it won't.
3. **KB corpus embedded (for true semantic recall — keyword-only still works without this).**
   `node scripts/ai-kb/embed-programming.mjs` reads `chunks.jsonl`, writes
   `knowledge/programming/<vendorSlug>/embeddings.jsonl` (1024-d Qwen3-Embedding-0.6B space). Without
   embeddings a collection silently falls back to keyword-only scoring (`semanticUsed:false`) — not a
   crash, just lower recall.
   - As of this doc, this dev machine's `knowledge/programming/manifest.json` (generated 2026-07-05)
     already lists 6 ingested + embedded vendor collections (delta, fanuc, mitsubishi, omron,
     universal-robots, zmotion — ~91k chunks total, all with `embeddings.jsonl` present). **Verify
     freshness on the actual ops box before relying on this** — don't assume it carries over; run
     `--selfcheck` (§4) to check the corpus status wherever the smoke will actually run.
4. **A code model available** (only needed for §5's codegen-level check, not §4's retrieval-only smoke).
   Either the in-process GGUF engine (`GGUF_DEFAULT_MODEL`/`GGUF_CODE_MODEL`) or the persistent
   `llama-server` per doc 70 (`docs/ECOSYSTEM/70_AI_PERSISTENT_LLAMA_SERVER_RUNBOOK_2026-07-26.md`),
   pointed at `GGUF_CODE_MODEL` (falls back to `GGUF_DEFAULT_MODEL`).

## 4. Run the smoke — `eval-rag-programming.mjs` (retrieval-only, the primary gate)

This is the harness STEP 0 identified as "what the ops smoke runs" — it calls the REAL
`searchProgrammingKb` (no re-implementation), so it measures exactly what `generateProgram()`'s
`retrieveContext()` would see.

```bash
# 1) Wiring/corpus check — NO model load, safe to run anytime, anywhere:
npx tsx scripts/ai-eval/eval-rag-programming.mjs --selfcheck

# 2) The real smoke — loads the 0.6B embed model, runs the golden rag-cases.json set (k=5):
npx tsx scripts/ai-eval/eval-rag-programming.mjs

# Optional: scope to one vendor, raise k, or run the CI-style hard gate:
npx tsx scripts/ai-eval/eval-rag-programming.mjs --only zmotion
npx tsx scripts/ai-eval/eval-rag-programming.mjs --ci --min 0.7
```

Notes on the script's own behavior (confirmed by reading it, not assumed):

- It sets `PROG_KB_ENABLED=true` itself if the env var is unset (`eval-rag-programming.mjs:220`) — so the
  smoke exercises the grounded path even before the operator flips the flag for the app. An explicit
  `PROG_KB_ENABLED=false` in the environment would still be honored (never overridden), which would just
  make the smoke measure the (trivial) disabled path — don't do that for this smoke.
- It does **not** touch `AI_PROGRAMMING_COPILOT_ENABLED` — it calls `searchProgrammingKb` directly, not
  the copilot.
- Report written to `scripts/ai-eval/reports/rag-<label>.json` (git-ignorable); pass `--label` for a
  named, comparable run.

### What a PASS looks like

- `--selfcheck` exits 0 ("selfcheck PASSED") — cases JSON valid, `aiProgrammingKnowledgeService` imports
  cleanly, and ideally no `WARN` about missing embeddings / embed-model mismatch / un-ingested vendors
  (warnings don't fail selfcheck, but a smoke with all-keyword-only retrieval is a weaker signal).
- The real run's printed table (and `reports/rag-<label>.json`) shows, per vendor and OVERALL:
  - **`hit@k` (hitRate) reasonably high** — the golden set targets `--min 0.7` as the CI floor
    (`--ci --min 0.7`); treat materially below that as a FAIL worth investigating (corpus staleness,
    embed-model mismatch) before enabling the flag in production.
  - **`sem%` (semanticUsedRate) > 0** for vendors that have `embeddings.jsonl` — `0%` everywhere means the
    corpus fell back to keyword-only (check `embedModelMatches` in the run header / `--selfcheck` output).
  - **`cites` (avgCitations) > 0** — a smoke where every case retrieves 0 citations means grounding would
    attach nothing even with the flag on; that's a FAIL regardless of `hit@k`.
  - No `ERROR:` rows (a case throwing during retrieval).
- Exit code `0` (or `1` only if `--ci` was passed and the gate failed — read the printed reason, don't
  just check the code).

**Lighter-weight manual alternatives** (older doc-34 smoke scripts, not the metrics harness above, but
useful for a quick eyeball): `npx tsx scripts/ai-kb/smoke-prog-kb.ts` (sets `PROG_KB_ENABLED=true` itself,
prints top citations for 5 fixed queries) and `npx tsx scripts/ai-kb/smoke-codegen.ts` (also sets
`AI_PROGRAMMING_COPILOT_ENABLED`/`AI_CODE_ROUTER_ENABLED`/`PROG_CODEGEN_VALIDATE_REQUIRED=true`, drives a
real `generateProgram()` call + asserts the safety hard-refusal). Neither produces a `reports/*.json` file
or a hit-rate metric — use `eval-rag-programming.mjs`/`eval-codegen.mjs` (§4/§5) as the PASS/FAIL record.

## 5. Re-verify: a live codegen result actually shows citations

`eval-rag-programming.mjs` proves retrieval quality; it does not itself call `generateProgram()`. To
confirm citations actually reach a generated program (the thing an engineer would see in the editor), run
the existing codegen eval, which reports `avgCitations` per case/kind and requires the code model
(§3, prerequisite 4):

```bash
npx tsx scripts/ai-eval/eval-codegen.mjs --limit 3   # quick — first 3 cases, loads the code model
```

`eval-codegen.mjs` defaults `AI_PROGRAMMING_COPILOT_ENABLED`, `PROG_KB_ENABLED`,
`AI_CODE_ROUTER_ENABLED`, and `PROG_CODEGEN_VALIDATE_REQUIRED` to `true` **only if unset** (never
overrides an explicit value) — so it exercises the real, fully-grounded `generateProgram()` path.
**PASS for this step:** non-refused cases show `cites=N` with `N > 0` in the console output (and
`avgCitations > 0` in `reports/codegen-<label>.json`'s `overall`/`perKind` blocks) for kinds/vendors the
corpus actually covers (delta, fanuc, mitsubishi, omron, universal-robots, zmotion per §3's manifest note).
`validPassRate` is a separate signal (code-quality, not grounding) — don't conflate a low `validPassRate`
with a grounding failure; see `scripts/ai-eval/README.md`'s caveat about the current 30B-Instruct code
tier.

## 6. Test evidence (this task, code-light)

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run \
  server/services/programming/aiProgrammingCopilot.test.ts \
  server/services/aiProgrammingKnowledgeService.test.ts
```

Result: **2 files, 29 tests, all passed** (21 in `aiProgrammingCopilot.test.ts`, up from 20 — the new
`"PROG_KB_ENABLED=false (KB disabled) → citations empty, result still well-formed (no crash)"` case; 8 in
`aiProgrammingKnowledgeService.test.ts`, unchanged, already covering the KB service's own
`PROG_KB_ENABLED` on/off contract with a real fixture corpus). No live model or KB was loaded for these —
both files mock the GGUF engine / corpus-adjacent pieces per their existing conventions.

`npx tsc --noEmit` (heap 8192): clean for both touched test files; the repo's one pre-existing failure
(`client/src/pages/SessionManagement.tsx:194`, unrelated `userAgent` typing) is untouched by this task.

## 7. Enable `PROG_KB_ENABLED=true` (the ops action, after §4-§5 both PASS)

Set `PROG_KB_ENABLED=true` in the API process's environment (alongside the already-on
`AI_PROGRAMMING_COPILOT_ENABLED=true`) and restart the process (esbuild-bundled server — code changes and
env changes both require a restart to take effect). No code change, no migration — it's a pure env flip.

Re-verify **live** after the restart (not just the eval harnesses, which set the flag themselves):

1. `curl`/tRPC a real `programming.generate` (or whatever UI action calls `generateProgram`) for a kind +
   vendor the corpus covers (e.g. `iec61131-st` + vendor `"Mitsubishi"`), and confirm the response's
   `citations` array is non-empty and its `docTitle`/`page` values correspond to real manual pages ingested
   per §3 (prerequisite 2).
2. Spot-check one citation manually against the source PDF (`sourcePath` in the KB citation, or cross-
   reference `docTitle`+`page` against the vendor manual on disk) — the point of grounding is that the
   citation is real, not merely present.

## 8. Record the PROVEN-LIVE artifact

Once §4 (retrieval smoke), §5 (codegen citations), and §7 (live post-flip verification) all pass on the
ops box with `PROG_KB_ENABLED=true` actually set, append a PROVEN-LIVE entry to this doc (or the doc69
tracking doc) capturing:

- Date + hardware/host (matches the doc 69/70 convention: GPU box, model file, corpus generation date).
- `reports/rag-<label>.json`'s `overall` block (hitRate, meanPrecisionAtK, semanticUsedRate,
  avgCitations) from §4's real run.
- `reports/codegen-<label>.json`'s `overall.avgCitations` (and `validPassRate` for context) from §5.
- The specific live request + citation(s) captured in §7 (kind, vendor, one example
  `{docTitle, page}` that was spot-checked against the source manual).
- Confirmation `PROG_KB_ENABLED=true` is set in the actual running process's environment (not just the
  shell that ran the eval scripts).

**No PROVEN-LIVE entry exists yet** — this doc was produced CODE + RUNBOOK only, per the doc69 Wave-4 C3
scope discipline (same discipline docs 70 §10.5 and 71 follow): no live model, GPU, or KB corpus was
loaded to write it.

## 9. Rollback

Unset `PROG_KB_ENABLED` (or set it to anything other than `"true"`) and restart the API process —
`searchProgrammingKb` immediately reverts to the well-formed empty result, `generateProgram()` keeps
working (ungrounded, citations `[]`), no other cleanup needed. This is fully independent of
`AI_PROGRAMMING_COPILOT_ENABLED` — turning grounding off does not turn the copilot off, and vice versa
(§1).
