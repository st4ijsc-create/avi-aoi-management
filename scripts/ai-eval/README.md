# AI codegen + RAG eval harness (doc 34 · P4)

Objective, reproducible measurement of two things the Automation Programming Copilot depends on:

1. **Code-generation quality per language** — `eval-codegen.mjs` (+ `codegen-cases.json`)
2. **Programming-KB retrieval precision** — `eval-rag-programming.mjs` (+ `rag-cases.json`)

Both **reuse the production code** (they import the real services — they do not re-implement
retrieval or generation), so the numbers reflect what the copilot actually does. This is the
"§21 eval" that turns *"does it work?"* into numbers.

Reports are written to `scripts/ai-eval/reports/` (git-ignorable output).

---

## Why `tsx` (not plain `node`)

These are `.mjs` files that **import the TypeScript services** (`aiProgrammingCopilot`,
`programmingAdapter`, `aiProgrammingKnowledgeService`). Plain `node` cannot load `.ts`, so the
real run — and even `--selfcheck`, which imports the adapters to prove every kind is real —
must go through the repo's TypeScript loader, **`tsx`** (the same way `scripts/ai-kb/*.ts` run).

`node --check <file>.mjs` still works: it validates **syntax** only and does not resolve imports.

---

## 1. Codegen eval — `eval-codegen.mjs`

For each case in `codegen-cases.json`:

1. Calls the **real** `generateProgram({ kind, request, vendor })` (code-tier LLM → golden
   few-shot + cited RAG → substrate validation). The copilot warms the code model itself.
2. **Independently** re-runs the **oracle** — `programmingAdapter.getAdapter(kind).validate(code)`
   — a second, harness-owned call to the same safety substrate the engineer uses. This oracle
   result (not the copilot's own) is the headline `validationOk`.

### Metrics (per-kind + overall)

| metric | definition |
|---|---|
| `n` | cases in the group |
| `codeProducedRate` | producedCode / **non-safety** cases |
| `validPassRate` | oracle `validation.ok` / cases that **produced code AND were not refused** |
| `safetyRefusalRate` | refused / `mustRefuse` cases — **target 1.0** (hard gate) |
| `falseRefusalRate` | refused / **non-safety** cases — target 0.0 (over-refusal) |
| `avgLatencyMs` | mean `generateProgram` latency over **non-refused** (model-invoking) cases |
| `avgCitations` | mean RAG citations over non-refused cases |

Per case the report also stores `copilotValidationOk` (the copilot's own validation, which for
`ir-flow`/`iec61131-pou` additionally runs `compile()`/safety-linter) and `oracleAgrees`, so you
can see where the independent oracle and the copilot diverge.

### Safety gate (the one hard invariant)

Every `mustRefuse:true` case **must** be refused. If any safety case leaks a program the harness
prints `FAIL ✗` and **exits 1**. Everything else is informational — a low `validPassRate` is a
signal, never a harness failure (see caveat below).

### Run

```bash
npx tsx scripts/ai-eval/eval-codegen.mjs                      # full set (loads the 30B code model)
npx tsx scripts/ai-eval/eval-codegen.mjs --only iec61131-st   # one kind
npx tsx scripts/ai-eval/eval-codegen.mjs --limit 3            # first 3 cases (quick)
npx tsx scripts/ai-eval/eval-codegen.mjs --label baseline-2026-07-05
npx tsx scripts/ai-eval/eval-codegen.mjs --selfcheck          # wiring check — NO model load
```

Flags: `--only <kind>`, `--limit N`, `--label <name>`, `--cases <path>`, `--out <dir>`, `--selfcheck`.

The harness **defaults** `AI_PROGRAMMING_COPILOT_ENABLED`, `PROG_KB_ENABLED`,
`AI_CODE_ROUTER_ENABLED`, `PROG_CODEGEN_VALIDATE_REQUIRED` to `true` **only if unset** — an
explicit value in your `.env`/shell always wins.

> ### Honest caveat — `validPassRate` reflects the CURRENT model
> Per doc 34 **D2**, the code tier is currently **Qwen3-30B-A3B-Instruct** — a strong *general*
> model, **not** a dedicated coder model. Structured targets (`iec61131-pou` = POU JSON,
> `ir-flow` = IR-flow JSON) are hard for a general model to emit perfectly first-pass, so a
> **low `validPassRate` on those kinds is expected and is the SIGNAL to load Qwen3-Coder-30B**
> (doc 34 D2 / P4), not a defect. The substrate *catching* invalid output (validation fails,
> nothing is deployed) is the design working correctly. Text targets that hew to a golden
> example (`zmotion-basic`, `iec61131-st`) should score highest.

---

## 2. RAG retrieval eval — `eval-rag-programming.mjs`

For each case in `rag-cases.json`: `searchProgrammingKb({ query, vendor, topK:k })`, then over
the top-K chunks:

- **`hit@k`** — ≥1 top-K chunk's `docTitle`/`sourcePath` contains an `expectDocContains` entry
  **OR** its `text` contains an `expectKeywords` entry (case-insensitive).
- **`precision@k`** — matching top-K chunks / `min(k, retrieved)`.

### Metrics (overall + per-vendor)

| metric | definition |
|---|---|
| `hitRate` | hits / n (recall proxy) |
| `meanPrecisionAtK` | mean per-case precision@k |
| `semanticUsedRate` | cases where vector scoring contributed / n (else keyword-only) |
| `avgCitations` | mean citations returned |

The golden set is **grounded in the manuals actually ingested** into `knowledge/programming`
(docTitles, command tokens and pages were verified on disk): Universal Robots, Zmotion,
Mitsubishi, Omron, Fanuc, Delta — plus one Vietnamese query and one unfiltered query.

### CI gate (opt-in)

`--ci` (or setting `PROG_KB_EVAL_MIN`) fails (exit 1) when overall `hitRate < min` (default
`0.70`). Mirrors `scripts/ai-kb/eval-rag.mjs`.

### Run

```bash
npx tsx scripts/ai-eval/eval-rag-programming.mjs                     # full set, k=5 (loads 0.6B embed model)
npx tsx scripts/ai-eval/eval-rag-programming.mjs --k 8               # top-8
npx tsx scripts/ai-eval/eval-rag-programming.mjs --only zmotion      # one vendor scope
npx tsx scripts/ai-eval/eval-rag-programming.mjs --ci --min 0.7      # CI floor
npx tsx scripts/ai-eval/eval-rag-programming.mjs --selfcheck         # NO model load; prints corpus status
```

Flags: `--k N` (alias `--topk`), `--only <vendor>`, `--limit N`, `--label`, `--cases`, `--out`,
`--ci`, `--min <float>`, `--selfcheck`.

> If `--selfcheck` (or the run header) reports `semanticUsedRate` low / `embedModelMatches=false`
> / a collection without embeddings, retrieval fell back to **keyword-only**. Build embeddings
> with `scripts/ai-kb/embed-programming.mjs` and ensure the query embed model matches
> `manifest.embedModel` (Qwen3-Embedding-0.6B) for true semantic recall.

---

## Comparing runs

Each run writes `reports/codegen-<label>.json` / `reports/rag-<label>.json` with the full
per-case records + metrics + a timestamp. To compare (e.g. 30B-Instruct vs. a coder model, or
before/after a KB re-ingest), run with distinct `--label`s and diff the `overall` / `perKind` /
`perVendor` blocks:

```bash
npx tsx scripts/ai-eval/eval-codegen.mjs --label instruct-30b
# ...load Qwen3-Coder-30B, set GGUF_CODE_MODEL, re-run...
npx tsx scripts/ai-eval/eval-codegen.mjs --label coder-30b
# then diff reports/codegen-instruct-30b.json vs reports/codegen-coder-30b.json
```

The report is stable/reproducible: temperature is low, cases are fixed, and the oracle is
deterministic — so a metric delta between runs is a real signal from the model/KB change.

---

## `--selfcheck` (both scripts)

`--selfcheck` validates the harness **without loading any model**:

- the cases JSON parses and every case has the required fields (unique ids);
- the TS services import cleanly (reuse wiring intact);
- **codegen**: every `kind` is a real, implemented `programmingAdapter` kind (`getAdapter`
  does not throw) + prints case counts per kind;
- **rag**: prints the on-disk corpus status (chunks, per-vendor embeddings, embed-model match)
  and warns if a case's vendor is not an ingested collection.

Exit 0 = all critical checks pass. Run it first; then run the real (model-loading) eval.
