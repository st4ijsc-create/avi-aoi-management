#!/usr/bin/env bash
#
# delete-and-redden-web.sh — mutation sweep for the WEB half of WS-HMI-2: THE JOIN AND THE WRITE PATH.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# WHY THIS EXISTS, AND WHY IT IS SCOPED RATHER THAN COMPLETE
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# The WS-HMI-2 whole-branch review's judgement, quoted so the scope is not re-litigated from memory:
#
#     "the web half's pins are a snapshot, not an instrument"
#
# 77 % of the production code that branch adds is web, and 100 % of the committed falsification
# instrument (delete-and-redden.sh) pointed at the other 23 %. The per-task falsification done web-side
# was good work — a human chose each cut, several were discriminating controls rather than mere
# deletions — but every one of those cuts was applied, measured, reported and REVERTED. Not one is
# reproducible from the tree. A mutation sweep's value is not that it was right once; it is that it is a
# standing instrument someone runs later, on a change nobody predicted.
#
# 🔴 THIS DOES NOT BUY 79-ROW PARITY WITH THE .NET SIDE, DELIBERATELY. The review priced full parity at
# 4-5 hours over 6 353 lines and named it the wrong first purchase. It named the surface that matters
# instead — THE JOIN AND THE WRITE PATH — and this file covers exactly that, five files:
#
#   web/src/hmi-runtime/publishedScreen.ts   the join's arithmetic and its safety net
#   web/src/hmi-runtime/shippedScreens.ts    which document a machine falls back to
#   web/src/routes/Hmi.tsx                   the kiosk-document selection (kioskDoc)
#   web/src/editor/editorState.ts            the editor's guards
#   web/src/lib/api.ts                       the screen hooks
#
# 🔴 THE BRIEF THAT COMMISSIONED THIS NAMED THE FIRST FILE AS web/src/lib/publishedScreen.ts. THERE IS NO
# SUCH FILE. The join lives at web/src/hmi-runtime/publishedScreen.ts and always has; the mistaken path
# is recorded here rather than silently corrected, because a sweep whose SOURCES list is one directory
# off is the exact defect this family of scripts has now paid for four times, and the only reason it did
# not happen a fifth is that a missing file makes every pattern fail to match rather than fail quietly.
#
# Everything else under web/src/ — EditorCanvas, PropertyPanel, PublishPanel, LayerTree, TagPicker — is
# OUT OF SCOPE HERE and remains defended by prose plus the browser suites. That is a stated ceiling, not
# an oversight: a conclusion wider than the instrument is the defect delete-and-redden.sh's own header
# records having paid for three times.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE THREE MECHANICS, DECIDED AND JUSTIFIED — the web half needs its own, and they are NOT the .NET ones
# ══════════════════════════════════════════════════════════════════════════════════════════════════
#
# ── (1) WHICH COMMAND RUNS THE TESTS ──────────────────────────────────────────────────────────────
# `npm run test:runtime` — node --test over thirteen .mjs files — WHEREVER THE PROPERTY IS REACHABLE
# FROM NODE, and `npx playwright test <one spec>` ONLY where it is not. The whole of test:runtime is
# ~0.2 s of test time (~2 s including node start-up); one Playwright spec with its two webServer boots
# is 1.5-3 MINUTES. That is a two-orders-of-magnitude difference per row, so the split is not taste.
#
# WHAT MAKES A PROPERTY "REACHABLE FROM NODE" HERE, measured rather than assumed:
#   * Node 24 (node --version -> v24.18.0) strips TYPE syntax natively, so a plain .ts module with no
#     JSX is import()-able straight from source. publishedScreen.ts and editorState.ts both are, and
#     runtime-tests/screenJoin.test.mjs and editorState.test.mjs already EXECUTE them.
#   * routes/Hmi.tsx is NOT: Node's loader strips types but cannot parse JSX.
#   * hmi-runtime/shippedScreens.ts is NOT, despite being plain .ts: it imports JSON, and Node requires
#     an import attribute for that. (Its own header says so; re-verified here, not inherited.)
#   * lib/api.ts is NOT, and the reason is neither of the above — MEASURED IN THIS TREE:
#         node -e "import('./src/lib/api.ts')"
#         -> TypeError: Cannot read properties of undefined (reading 'VITE_ENGINE_URL')
#     The module parses and strips fine and then dies evaluating import.meta.env, which is Vite's, not
#     Node's. So every behavioural property of the five screen hooks is browser-only.
#
# So: publishedScreen.ts and editorState.ts rows run under test:runtime; shippedScreens.ts, Hmi.tsx and
# api.ts rows run under Playwright, against ONE NAMED SPEC rather than all 290 tests.
#
# ── (2) HOW A MUTATION IS CONFIRMED TO HAVE LANDED IN A .ts/.tsx FILE ─────────────────────────────
# The same sentinel grep the .NET harness uses, against the same hazard, plus a type check, because
# "landed" and "is a plausible refactor" are two different claims:
#
#   * SENTINEL PRESENT IN SOURCE, grep -F, BEFORE the run and AGAIN AFTER it. A mutation that did not
#     apply and a mutation that vanished mid-run are both NO EVIDENCE, and reading either as "green" is
#     the failure this whole family of scripts exists to prevent.
#
#   * 🔴 LINE ENDINGS ARE MIXED IN THIS SET TOO, MEASURED NOT ASSUMED:
#         publishedScreen.ts  CRLF        shippedScreens.ts  LF
#         Hmi.tsx             CRLF        editorState.ts     CRLF        api.ts  CRLF
#     One of the five is LF and four are CRLF — the exact ratio that defeated three earlier .NET sweeps,
#     now live on the web side. EVERY multi-line pattern below uses \r?\n, without exception, including
#     in the file that is LF today: a file's line endings are not a property anybody is guarding.
#
#   * `npx tsc -b` MUST REPORT NO `error TS`, reported as MUTATION DID NOT COMPILE rather than folded
#     into a pass/fail count. Node strips types WITHOUT CHECKING them, so a type-broken mutation would
#     run happily and its row would read as an ordinary measurement of something no engineer could have
#     written. tsc is what makes a row a plausible refactor rather than a mangling.
#
# ── (3) HOW WE KNOW THE RUNNER USED THE MUTATED SOURCE — THE WEB CHECKSUM RULE ─────────────────────
# This is the analogue of sums_for()'s md5-of-the-deployed-DLL, and it is the mechanic this project has
# been burned by FOUR times: twice by an mtime-preserving copy, once by a locked DLL, once by a
# comment-scanner that could not see template literals. The answer DIFFERS between the two runners
# because the artefact under test differs, and both halves were established by looking:
#
#   NODE ROWS — THERE IS NO INTERMEDIATE ARTEFACT, AND THAT WAS CHECKED, NOT ASSUMED.
#     node --test starts a FRESH PROCESS per row and strips types IN MEMORY. For a cache to exist it
#     would have to be on disk, and the four places one could be are all empty in this tree:
#       - NODE_COMPILE_CACHE is UNSET (env | grep NODE_ -> nothing), so V8's code cache is off; and even
#         enabled it is keyed on source content, so it cannot serve a different file's bytes.
#       - web/node_modules/.cache DOES NOT EXIST.
#       - web/node_modules/.vite/ holds deps/ ONLY — the pre-bundled node_modules. Grepped for two
#         identifiers that exist nowhere but our own source (machineScreenId, unrenderableReason): ZERO
#         hits. Vite's cache does not contain project source. 🔴 THIS IS THE "DO NOT ASSUME VITE HAS NO
#         CACHE" QUESTION, ANSWERED BY LOOKING RATHER THAN BY REPUTATION: Vite DOES have a persistent
#         on-disk cache, it is real, and what it holds is dependencies.
#       - no *.tsbuildinfo outside node_modules/.tmp/, and that one belongs to tsc, not to Node. It IS
#         mtime-driven, which is precisely why restore() below is a writer and not cp -p.
#     The per-row evidence is therefore: the source md5 MOVED from the pristine copy (a row where it did
#     not is STALE SOURCE and not a measurement), the sentinel is present before AND after the run, and
#     the process that read it was created after both.
#     🔴 THE STRUCTURAL ARGUMENT IS NOT TRUSTED ON ITS OWN — CONTROL R below falsifies it by running the
#     SAME mutation, a restore, and the SAME mutation again, requiring RED, GREEN, RED. A cache anywhere
#     on that path makes the second or third result wrong. A detector that has never fired is a claim,
#     not an instrument; this one fires on demand, in the same run, before any Node row is believed.
#
#   PLAYWRIGHT ROWS — THERE IS AN INTERMEDIATE ARTEFACT AND IT IS SERVED OVER HTTP.
#     The browser never sees the file; it sees whatever the Vite dev server transformed it into. So the
#     checksum is taken ON THE SERVED BYTES, not on the file:
#         curl -s http://127.0.0.1:$ORACLE_PORT/src/<path>   ->  md5
#     taken once from the pristine tree and again after the mutation. IF THE TWO ARE EQUAL THE ROW IS
#     STALE BUILD AND THE SUITE IS NOT RUN, exactly as a byte-identical DLL is on the .NET side. That
#     catches a watcher that missed the write, a transform cache answering from memory, and a server
#     someone left running from an older tree — the three ways this could go wrong.
#     The oracle is a SECOND Vite server this script starts on its own port. Playwright still boots its
#     OWN pair (vite on 5173, St4i.EngineApi on 5199) per row, AFTER the mutation is on disk and with
#     scripts/reset-engine-state.mjs wiping the store each time, so no row inherits another row's
#     published screens — which matters, because 43-editor-acceptance both ASSERTS a 404 precondition for
#     the three baseline machines and PUBLISHES over one of them in a later test.
#     🔴 STATED CEILING: the oracle proves THIS Vite process serves mutated bytes for that module. It is
#     evidence about Playwright's process by construction — same binary, same config, same file on the
#     same disk, started later — not by direct observation of it. A stronger check would need Playwright's
#     own port, which does not exist between rows. Stated so the next reader can weigh it rather than
#     re-derive it.
#
#     🔴 AND WHY IT IS A CHECKSUM RATHER THAN A SENTINEL GREP ON THE SERVED BYTES — MEASURED, and it is
#     the web's own version of the comment-scanner hazard this project has already paid for once. The
#     obvious design is "grep the served module for the sentinel". IT DOES NOT WORK: esbuild, which is
#     what Vite transforms .ts with, KEEPS JSDoc block comments and STRIPS `//` line comments. Probed
#     directly on this tree — mutate LAYOUT_DIMENSION_MAX with a trailing `// MUTANT-ORACLE-PROBE`, then
#     fetch the module from the running server:
#         sentinel present in SOURCE      : yes
#         sentinel present in SERVED bytes: NO — 0 occurrences
#         served md5 before -> after      : 45fb96d2... -> d59fa5da...   (MOVED)
#         served md5 after restore        : 45fb96d2...                 (RETURNED)
#     A sentinel grep would have reported "did not land" for every row whose marker is a line comment: a
#     non-measurement dressed as a diagnosis. The md5 is blind to WHERE the change is and asks only
#     whether the executable bytes moved, which is the question being asked.
#     That same probe is also the positive evidence that Vite's dev server holds no stale transform
#     cache: within ONE long-lived server process the checksum moved on the write and came back on the
#     restore. The mechanism is not being taken on trust.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 DO NOT KILL THIS SCRIPT MID-ROW — the EXIT trap restores on Ctrl-C and on ordinary failure, but a
# SIGKILL leaves the CURRENT row's mutation on disk. Recovery:
#     grep -rn "MUTANT" web/src/                  # expect NO output
#     git status --porcelain -- web/              # expect nothing but your own edits
#
# 🔴 RESTORE IS A WRITER, NOT A COPY THAT PRESERVES mtime. restore() writes each pristine file back
# through a shell redirect, so its mtime is NOW. cp -p, rsync -t or git checkout would each defeat
# something: the first two let tsc -b's incremental buildinfo (node_modules/.tmp/) and Vite's watcher
# conclude nothing changed — WS-HMI-0c's exact hazard, one runner over — and git checkout is VACUOUS on
# an untracked file and would silently restore nothing at all.
#
# 🔴 HOW LONG IT TAKES. The Node rows are ~10 s each, almost all of it tsc. The Playwright rows are
# 1.5-3 minutes each, almost all of it the two webServer boots. Budget on the Playwright count, not the
# row count.
#
# USAGE
#   bash tools/machine-simulator/scripts/delete-and-redden-web.sh
#   ORACLE_PORT=5174 bash .../delete-and-redden-web.sh        # if 5174 is taken
# ══════════════════════════════════════════════════════════════════════════════════════════════════

set -u

cd "$(dirname "$0")/.." || exit 1

PUB=web/src/hmi-runtime/publishedScreen.ts
SHIP=web/src/hmi-runtime/shippedScreens.ts
HMI=web/src/routes/Hmi.tsx
EDS=web/src/editor/editorState.ts
API=web/src/lib/api.ts

WEB_SOURCES="$PUB $SHIP $HMI $EDS $API"

ORACLE_PORT="${ORACLE_PORT:-5174}"
ORACLE_LOG="$(mktemp)"
ORACLE_PID=""

key_for() { echo "$1" | md5sum | cut -c1-8; }
# 🔴 `localhost`, NOT `127.0.0.1`, AND IT WAS MEASURED. Vite binds its dev server to the host name,
# and on this box that resolves to IPv6 FIRST: `netstat` shows the listener as `[::1]:5174` and
# nothing on `0.0.0.0`. So `curl http://127.0.0.1:5174/<module>` returns HTTP 000 / 0 bytes while
# `curl http://localhost:5174/<module>` returns 200 and 41 912 bytes — same server, same module.
# Written as 127.0.0.1 this oracle would have answered nothing for every row and every Playwright
# row would have reported NO ORACLE. That is a harness failing safe, and it only fails safe because
# "the oracle said nothing" has its OWN verdict; folded into the equal-checksums branch it would
# have printed STALE BUILD, which is a confident wrong diagnosis of a healthy tree.
served_url() { echo "http://localhost:$ORACLE_PORT/${1#web/}"; }

# md5 of what the Vite dev server TRANSFORMS a module into — the bytes a browser would execute.
served_sum() {
  local body
  body=$(curl -s --max-time 30 "$(served_url "$1")" 2>/dev/null)
  [ -z "$body" ] && return 0
  printf '%s' "$body" | md5sum | cut -d' ' -f1
}

src_sum() { md5sum "$1" | cut -d' ' -f1; }

BK="$(mktemp -d)"
for f in $WEB_SOURCES; do cp "$f" "$BK/$(basename "$f")"; done
restore() { for f in $WEB_SOURCES; do cat "$BK/$(basename "$f")" > "$f"; done; }
cleanup() {
  restore
  [ -n "$ORACLE_PID" ] && kill "$ORACLE_PID" 2>/dev/null
  rm -rf "$BK" "$ORACLE_LOG"
}
trap cleanup EXIT

start_oracle() {
  ( cd web && exec npx vite --port "$ORACLE_PORT" --strictPort ) > "$ORACLE_LOG" 2>&1 &
  ORACLE_PID=$!
  local i
  for i in $(seq 1 40); do
    curl -s --max-time 3 "http://localhost:$ORACLE_PORT/" > /dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# ── baselines: the pristine source md5 and the pristine SERVED md5 for every file ─────────────────
declare -A BASE_SRC
declare -A BASE_SERVED
snapshot_baselines() {
  local f
  for f in $WEB_SOURCES; do
    BASE_SRC["$f"]=$(src_sum "$f")
    if [ "${NEEDS_ORACLE:-1}" = "1" ]; then BASE_SERVED["$f"]=$(served_sum "$f"); else BASE_SERVED["$f"]=""; fi
  done
}

# 🔴 `ONLY` — RUN A SUBSET. Same device, same caveat, as delete-and-redden.sh's: it restricts which rows
# are MEASURED; every other row's mutation is still applied and immediately restored, so the tree ends
# identical either way. It exists here for a reason that is specific to this file: the Node rows and the
# Playwright rows have wildly different costs AND different neighbours — a Playwright row boots
# St4i.EngineApi, so it must never run while a .NET suite is running, while a Node row can run beside
# anything. Being able to say ONLY='^W1?[0-9] ' (the Node half) and ONLY='^W(19|2[0-6]) ' (the browser
# half) is what lets a full perimeter pass interleave this sweep with the .NET one without overlap.
# A SUBSET RUN IS NOT "THE SWEEP" — it prints a banner saying so, for the reason the .NET file gives.
ONLY="${ONLY:-}"

PREAMBLE_FAIL=""
MUTATION_TSC=""
preamble() {
  local sentinel="$1" needs_oracle="$2" mutated tscout after
  PREAMBLE_FAIL=""
  MUTATION_TSC=""

  if ! grep -qF -- "$sentinel" $WEB_SOURCES; then
    PREAMBLE_FAIL="MUTATION DID NOT LAND (sentinel '$sentinel' absent) — NOT A MEASUREMENT"
    return
  fi
  mutated=$(grep -lF -- "$sentinel" $WEB_SOURCES | head -1)

  if [ "$(src_sum "$mutated")" = "${BASE_SRC[$mutated]}" ]; then
    PREAMBLE_FAIL="STALE SOURCE ($mutated is byte-identical to the pristine copy) — NOT A MEASUREMENT"
    return
  fi

  tscout=$(cd web && npx tsc -b 2>&1)
  if echo "$tscout" | grep -q "error TS"; then
    PREAMBLE_FAIL="MUTATION DID NOT COMPILE — NOT A MEASUREMENT"
    MUTATION_TSC="$(echo "$tscout" | grep -m2 "error TS")"
    return
  fi

  if [ "$needs_oracle" = "oracle" ]; then
    after=$(served_sum "$mutated")
    if [ -z "$after" ]; then
      PREAMBLE_FAIL="NO ORACLE — the Vite server on :$ORACLE_PORT did not serve $mutated. NOT A MEASUREMENT"
      return
    fi
    if [ "${BASE_SERVED[$mutated]}" = "$after" ]; then
      PREAMBLE_FAIL="STALE BUILD (the module Vite serves for $mutated is byte-identical to the pre-mutation transform) — NOT A MEASUREMENT"
      return
    fi
  fi
}

measure_node() {
  local label="$1" sentinel="$2" out passed failed
  if [ -n "$ONLY" ] && ! echo "$label" | grep -Eq -- "$ONLY"; then restore; return; fi
  preamble "$sentinel" "node"
  if [ -n "$PREAMBLE_FAIL" ]; then
    echo "### $label => $PREAMBLE_FAIL"
    [ -n "$MUTATION_TSC" ] && echo "$MUTATION_TSC" | sed 's/^/      /'
    restore; return
  fi

  out=$(cd web && npm run test:runtime 2>&1)

  if ! grep -qF -- "$sentinel" $WEB_SOURCES; then
    echo "### $label => MUTATION VANISHED MID-RUN (sentinel '$sentinel' gone after the run) — NOT A MEASUREMENT"
    restore; return
  fi

  # 🔴 PARSED FROM THE REPORTER THIS TREE ACTUALLY USES, NOT FROM TAP. `node --test`'s default spec
  # reporter prints `<U+2139> pass 471` / `<U+2139> fail 0` and marks a failing test with a leading
  # U+2716 (E2 9C 96) — it does NOT print `# pass` or `not ok`, which is what a TAP-shaped parser would
  # look for. A parser that matches nothing reports every row as `Failed: ?, Passed: ?`, which reads as
  # a broken harness rather than as a result, but a parser that matched only the PASS line would have
  # been worse: it would have printed a plausible number for a row it could not see the failures of.
  # Measured against a real run before being written.
  passed=$(echo "$out" | grep -E ' pass [0-9]+$' | tail -1 | awk '{print $NF}')
  failed=$(echo "$out" | grep -E ' fail [0-9]+$' | tail -1 | awk '{print $NF}')
  echo "### $label => Failed: ${failed:-?}, Passed: ${passed:-?}   [test:runtime]"
  # 🔴 THE FAILING-TEST MARKER IS MATCHED BY HEX ESCAPE, NOT BY A LITERAL CHARACTER. node --test's spec
  # reporter marks a failure with U+2716 (bytes E2 9C 96). Writing that character into this script once
  # got it re-encoded to mojibake (C3 A2 C2 9C C2 96) by an editing pass, and the grep then matched
  # NOTHING — every row printed its counts and NO test names, which reads as "no failures were named
  # rather than as "the extractor is broken". Same family as the CRLF regexes: a pattern that silently
  # cannot match. perl with \xNN keeps this line pure ASCII, so no encoding pass can damage it.
  echo "$out" | perl -ne 'print if /^\xe2\x9c\x96 /' | perl -pe 's/^\xe2\x9c\x96 //' | grep -v 'failing tests:' | sed -E 's/ \([0-9.]+ms\)$//' | cut -c1-150 | sort -u | sed 's/^/      RED /'
  restore
}

measure_pw() {
  local label="$1" sentinel="$2" spec="$3" out passed failed
  if [ -n "$ONLY" ] && ! echo "$label" | grep -Eq -- "$ONLY"; then restore; return; fi
  preamble "$sentinel" "oracle"
  if [ -n "$PREAMBLE_FAIL" ]; then
    echo "### $label => $PREAMBLE_FAIL"
    [ -n "$MUTATION_TSC" ] && echo "$MUTATION_TSC" | sed 's/^/      /'
    restore; return
  fi

  out=$(cd web && npx playwright test "$spec" --reporter=list 2>&1)

  if ! grep -qF -- "$sentinel" $WEB_SOURCES; then
    echo "### $label => MUTATION VANISHED MID-RUN (sentinel '$sentinel' gone after the run) — NOT A MEASUREMENT"
    restore; return
  fi

  passed=$(echo "$out" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+')
  failed=$(echo "$out" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+')
  echo "### $label => Failed: ${failed:-0}, Passed: ${passed:-?}   [$spec]"
  echo "$out" | grep -E '^[[:space:]]+[0-9]+\) ' | sed -E 's/^[[:space:]]+[0-9]+\) //' | cut -c1-150 | sort -u | sed 's/^/      RED /'
  restore
}

# ══════════════════════════════════════════════════════════════════════════════════════════════════
# START-UP: the oracle, the baselines, the two baselines nobody may skip, and CONTROL R
# ══════════════════════════════════════════════════════════════════════════════════════════════════

if [ -n "$ONLY" ]; then
  echo "🔴 SUBSET RUN — ONLY='$ONLY'. The rows this filter excludes were NOT MEASURED on this run."
  echo "🔴 This output is not 'the sweep'. See ONLY's comment above."
fi

# The oracle is only needed by Playwright rows. Starting a Vite server for a Node-only subset would burn
# 20 s and, worse, put a second file watcher on the tree during rows that do not need one.
NEEDS_ORACLE=1
# 🔴 EACH CANDIDATE CARRIES ITS TRAILING SPACE. Every row label is "<id> <prose>", so every ONLY regex
# written for this file ends in a space ("^W(19|20) "). Testing it against the BARE token "W19" therefore
# matched nothing, NEEDS_ORACLE went to 0, and the Playwright rows reported NO ORACLE — a non-measurement
# caused by the harness, not by the tree. Measured, not reasoned about: the first run of this subset
# produced exactly that.
if [ -n "$ONLY" ]; then
  NEEDS_ORACLE=0
  for _r in "W19 " "W20 " "W21 " "W22 " "W23 " "W24 " "W25 " "W26 "; do
    printf '%s
' "$_r" | grep -Eq -- "$ONLY" && NEEDS_ORACLE=1
  done
fi

echo "=== ORACLE: a second Vite dev server on :$ORACLE_PORT, for the served-bytes checksum ==="
if [ "$NEEDS_ORACLE" = "0" ]; then
  echo "### oracle => NOT STARTED (this subset contains no Playwright row, so nothing needs the served-bytes checksum)"
elif start_oracle; then
  echo "### oracle => UP on :$ORACLE_PORT"
else
  echo "### oracle => DID NOT START — every Playwright row below will report NO ORACLE (see the header)."
fi

snapshot_baselines

echo "=== BASELINE (no mutation) ==="
# Deliberately NOT run through measure_node/measure_pw: there is no mutation, so there is no sentinel
# to confirm, and asking for one prints a spurious DID NOT LAND beside a perfectly good green — the
# same reasoning delete-and-redden.sh's own baseline carries.
BASE_OUT=$(cd web && npm run test:runtime 2>&1)
echo "### baseline (test:runtime) => Failed: $(echo "$BASE_OUT" | grep -E ' fail [0-9]+$' | tail -1 | awk '{print $NF}'), Passed: $(echo "$BASE_OUT" | grep -E ' pass [0-9]+$' | tail -1 | awk '{print $NF}')"

# ── 🔴 CONTROL R — THE NODE FRESHNESS CONTROL, AND IT RUNS BEFORE ANY NODE ROW IS BELIEVED ────────
# The Node half of mechanic (3) is a STRUCTURAL argument: fresh process, no compile cache, no Vite
# cache holding project source. A structural argument is a claim. This makes it an instrument: the SAME
# mutation, a restore, and the SAME mutation again, requiring RED / GREEN / RED. Any cache on that path
# — V8 code cache, a type-strip cache, an OS page cache serving a pre-write image — breaks run 2 or 3.
# Three states are printed rather than two, because "it went red twice" is also what a permanently
# broken tree looks like; the GREEN in the middle is what makes the reds mean something.
echo "=== CONTROL R — does node --test re-read the source between runs? (expect RED / GREEN / RED) ==="
control_run() {
  local out
  out=$(cd web && npm run test:runtime 2>&1)
  echo "      $1 => Failed: $(echo "$out" | grep -E ' fail [0-9]+$' | tail -1 | awk '{print $NF}'), Passed: $(echo "$out" | grep -E ' pass [0-9]+$' | tail -1 | awk '{print $NF}')"
}
perl -0777 -pi -e 's/export const LAYOUT_DIMENSION_MAX = 48/export const LAYOUT_DIMENSION_MAX = 4800 \/\/ MUTANT-CTRL-R/' $PUB
grep -qF "MUTANT-CTRL-R" $PUB && control_run "R1 mutated  (expect RED)"
restore
control_run "R2 restored (expect GREEN)"
perl -0777 -pi -e 's/export const LAYOUT_DIMENSION_MAX = 48/export const LAYOUT_DIMENSION_MAX = 4800 \/\/ MUTANT-CTRL-R/' $PUB
grep -qF "MUTANT-CTRL-R" $PUB && control_run "R3 mutated again (expect RED)"
restore

# ══════════════════════════════════════════════════════════════════════════════════════════════════
# publishedScreen.ts — THE JOIN'S ARITHMETIC AND ITS SAFETY NET.  Node-reachable, every row.
# ══════════════════════════════════════════════════════════════════════════════════════════════════

perl -0777 -pi -e 's/  return SCREEN_ID_PATTERN\.test\(candidate\) \? candidate : undefined/  return candidate \/\/ MUTANT-W1/' $PUB
measure_node "W1  machineScreenId stops gating the derived id on the frozen pattern | guards: a machine code that cannot make a LEGAL screenId answers undefined rather than a best effort" "MUTANT-W1"

perl -0777 -pi -e 's/  const candidate = `\$\{MACHINE_SCREEN_ID_PREFIX\}\$\{trimmed\.toLowerCase\(\)\}`/  const candidate = `\$\{MACHINE_SCREEN_ID_PREFIX\}\$\{trimmed\}` \/\/ MUTANT-W2/' $PUB
measure_node "W2  the machine-code case fold removed | guards: AOI-01 and aoi-01 are ONE machine and get ONE panel — the fold that crosses from machine-code vocabulary into screenId vocabulary" "MUTANT-W2"

perl -0777 -pi -e 's/export const MACHINE_SCREEN_ID_PREFIX = "machine-"/export const MACHINE_SCREEN_ID_PREFIX = "panel-" \/\/ MUTANT-W3/' $PUB
measure_node "W3  the reserved namespace prefix changed | guards: the machine- sub-namespace the whole §5-bis baseline argument rests on" "MUTANT-W3"

perl -0777 -pi -e 's/export const SCREEN_ID_PATTERN = \/\^\[a-z0-9-\]\+\$\//export const SCREEN_ID_PATTERN = \/\^\[A-Za-z0-9-\]\+\$\/ \/\/ MUTANT-W4/' $PUB
measure_node "W4  SCREEN_ID_PATTERN widened to accept uppercase | guards: the mirror is held to contracts/hmi-screen.schema.json ON DISK, not to a second copy of the rule" "MUTANT-W4"

perl -0777 -pi -e 's/export const LAYOUT_DIMENSION_MAX = 48/export const LAYOUT_DIMENSION_MAX = 4800 \/\/ MUTANT-W5/' $PUB
measure_node "W5  LAYOUT_DIMENSION_MAX 48 -> 4800 | guards: the frozen [1..48] mirror, and with it the security review MEDIUM-2 net behind a rollback that does not re-validate" "MUTANT-W5"

perl -0777 -pi -e 's/  if \(typeof value !== "number" \|\| !Number\.isInteger\(value\)\) \{/  if (typeof value !== "number") \{ \/\/ MUTANT-W6/' $PUB
measure_node "W6  the layout integer-ness check dropped | guards: cols:12.5 is finite and in range and still a fractional CSS track count the schema's type:integer forbids" "MUTANT-W6"

perl -0777 -pi -e 's/  if \(value < LAYOUT_DIMENSION_MIN \|\| value > LAYOUT_DIMENSION_MAX\) \{/  if (false) \{ \/\/ MUTANT-W7/' $PUB
measure_node "W7  the layout RANGE check dropped, finiteness kept | guards: MEDIUM-2 exactly — cols:1e9 was finite, passed, and reached repeat(1000000000, minmax(0,1fr))" "MUTANT-W7"

perl -0777 -pi -e 's/  if \(!Array\.isArray\(doc\.widgets\)\) return `widgets is \$\{describeValue\(doc\.widgets\)\}`/  if (!Array.isArray(doc.widgets)) return undefined \/\/ MUTANT-W8/' $PUB
measure_node "W8  a non-array widgets is reported RENDERABLE | guards: widgets.map(...) throwing takes the whole kiosk page down rather than degrading one cell" "MUTANT-W8"

perl -0777 -pi -e 's/  const holeAt = doc\.widgets\.findIndex\(\(widget\) => !isPlainObject\(widget\)\)/  const holeAt = doc.widgets.findIndex(() => false) \/\/ MUTANT-W9/' $PUB
measure_node "W9  the null-widget hole scan never finds a hole | guards: clampRectToLayout(widget.rect) throwing on a null entry — the clamp is defensive about the rect, not about the widget being absent" "MUTANT-W9"

# 🔴 W10 IS `bad !== null`, NOT `bad === undefined || true`, AND THE REASON IS A REAL TYPESCRIPT FACT
# THIS SWEEP LEARNED BY BEING REFUSED. The obvious cut — `|| true` — makes the condition STATICALLY true,
# so TypeScript marks everything after the `return` unreachable, and IN UNREACHABLE CODE IT STOPS
# APPLYING NARROWING: `isPlainObject(doc)` no longer narrows `doc` for `alreadyWarned.has(doc)` two lines
# down, and the row died as MUTATION DID NOT COMPILE (TS2345, twice). `bad !== null` is always true at
# RUNTIME — `bad` is `string | undefined` and never null — while being opaque to the compiler, so the
# safety net is just as disabled and the file still type-checks. The distinction matters beyond this row:
# a mutation that trips the compiler measures nothing, and the compiler's reachability analysis is a
# whole class of `if (false)` / `|| true` cuts that will not work in a .ts file even though the exact
# same shape is the .NET sweep's workhorse.
perl -0777 -pi -e 's/  if \(bad === undefined\) return doc as HmiScreenDocument/  if (bad !== null) return doc as HmiScreenDocument \/\/ MUTANT-W10/' $PUB
measure_node "W10 renderableScreen returns every document, reason or not | guards: THE SAFETY NET ITSELF — the whole function reduced to a pass-through" "MUTANT-W10"

perl -0777 -pi -e 's/  return machines\.find\(\(machine\) => machineScreenId\(machine\.code\) === screenId\)/  return machines.find((machine) => `machine-` + machine.code.toLowerCase() === screenId) \/\/ MUTANT-W11/' $PUB
measure_node "W11 machineForScreenId does string surgery instead of inverting against the live roster | guards: it can only ever name a machine that EXISTS, and names it in the roster's own spelling" "MUTANT-W11"

# ══════════════════════════════════════════════════════════════════════════════════════════════════
# editorState.ts — THE WRITE PATH'S GUARDS.  Node-reachable, every row.
# ══════════════════════════════════════════════════════════════════════════════════════════════════

perl -0777 -pi -e 's/const WIDGET_ID_PATTERN = \/\^\[a-z0-9-\]\+\$\//const WIDGET_ID_PATTERN = \/\^\[A-Za-z0-9_-\]\+\$\/ \/\/ MUTANT-W12/' $EDS
measure_node "W12 the editor's widget-id pattern widened to accept uppercase and underscore | guards: the hand-written mirror of \$defs/widget.properties.id held to the schema by the differential corpus" "MUTANT-W12"

perl -0777 -pi -e 's/      if \(indexOfWidget\(doc, id\) >= 0\) \{/      if (false) \{ \/\/ MUTANT-W13/' $EDS
measure_node "W13 add stops refusing a duplicate widget id | guards: four edits address a widget BY id, so a duplicate makes move/set-prop/remove/reorder ambiguous and undo unreproducible" "MUTANT-W13"

# 🔴 W14 COMPARES AGAINST THE OLD ID INSTEAD OF DELETING THE CHECK, for the reason W10 above states and
# then some. `if (false)` here died as MUTATION DID NOT COMPILE (TS2339 on `widgetId` and `newId`):
# `edit` is a discriminated union narrowed to the `rename` member BY THE SWITCH, and in a branch the
# compiler proves unreachable that narrowing is discarded, so the union's own members stop existing.
# Comparing `other.id === edit.widgetId` — the id being renamed FROM — is a better cut anyway: it is
# exactly the copy-paste a human makes, it compiles, and it leaves a check that LOOKS present and
# refuses nothing a rename can actually collide with.
perl -0777 -pi -e 's/      if \(doc\.widgets\.some\(\(other, i\) => i !== index && other\.id === edit\.newId\)\) \{/      if (doc.widgets.some((other, i) => i !== index \&\& other.id === edit.widgetId)) \{ \/\/ MUTANT-W14/' $EDS
measure_node "W14 rename checks the OLD id for a collision instead of the new one | guards: the SECOND edit that can create a duplicate — a check that is present and answers the wrong question" "MUTANT-W14"

perl -0777 -pi -e 's/  if \(typeof kind !== "string" \|\| !Object\.hasOwn\(WIDGET_KINDS, kind\)\) \{/  if (typeof kind !== "string") \{ \/\/ MUTANT-W15/' $EDS
measure_node "W15 the widget-KIND enum check dropped | guards: \$defs/widget.properties.kind's fifteen-member enum, mirrored exhaustively in both directions" "MUTANT-W15"

perl -0777 -pi -e 's/export const UNDO_DEPTH_LIMIT = 100/export const UNDO_DEPTH_LIMIT = 5 \/\/ MUTANT-W16/' $EDS
measure_node "W16 the undo stack bound 100 -> 5 | guards: the depth is pinned against a LITERAL in the test on purpose, so reading the constant from both ends cannot make it pass at any bound" "MUTANT-W16"

perl -0777 -pi -e 's/    layout: \{ cols: 12, rows: 8, breakpoint: "panel" \},/    layout: \{ cols: 0, rows: 8, breakpoint: "panel" \}, \/\/ MUTANT-W17/' $EDS
measure_node "W17 createBlankScreen starts a new screen at cols:0 | guards: a NEW SCREEN the publish door would refuse is a button that can only ever fail — validated against Milestone 0's real validate.mjs" "MUTANT-W17"

perl -0777 -pi -e 's/  if \(typeof id !== "string" \|\| !WIDGET_ID_PATTERN\.test\(id\)\) \{/  if (typeof id !== "string") \{ \/\/ MUTANT-W18/' $EDS
measure_node "W18 the widget-id PATTERN check dropped from widgetRefusal (the pattern itself untouched) | guards: the door, not the vocabulary — W12's control" "MUTANT-W18"

# ══════════════════════════════════════════════════════════════════════════════════════════════════
# shippedScreens.ts, Hmi.tsx, api.ts — NOT REACHABLE FROM NODE (see mechanic (1)).  Playwright rows.
# ══════════════════════════════════════════════════════════════════════════════════════════════════

# 🔴 W19 KEEPS `aoiOverview` REFERENCED. Repointing the AoiAvi row at the automation document leaves the
# aoiOverview import read by nothing, and tsconfig.app.json sets noUnusedLocals — measured:
#     src/hmi-runtime/shippedScreens.ts(36,1): error TS6133: 'aoiOverview' is declared but its value is never read.
# So the row swaps the row's VALUE and parks the now-unused import behind a `void`, which changes no
# behaviour and keeps the cut a plausible refactor rather than a mangling.
perl -0777 -pi -e 's/  AoiAvi: aoiOverview as HmiScreenDocument,/  AoiAvi: automationOverview as HmiScreenDocument, \/\/ MUTANT-W19/' $SHIP
perl -0777 -pi -e 's/(export const SHIPPED_SCREEN_DOCS)/void aoiOverview
$1/' $SHIP
measure_pw "W19 the AoiAvi row of the shipped table points at the AUTOMATION document | guards: one document per DeviceClass — which panel an operator falls back to when nobody has published" "MUTANT-W19" "tests/43-editor-acceptance.spec.ts"

perl -0777 -pi -e 's/  const kioskDoc = demoScreen \?\? renderableScreen\(publishedScreen\.data\) \?\? SHIPPED_SCREEN_DOCS\[machine\.class\]/  const kioskDoc = demoScreen ?? publishedScreen.data ?? SHIPPED_SCREEN_DOCS[machine.class]; void renderableScreen \/\/ MUTANT-W20/' $HMI
measure_pw "W20 kioskDoc stops passing the published document through renderableScreen | guards: the safety net is APPLIED AT THE CALL SITE, not merely exported" "MUTANT-W20" "tests/43-editor-acceptance.spec.ts"

perl -0777 -pi -e 's/  const kioskDoc = demoScreen \?\? renderableScreen\(publishedScreen\.data\) \?\? SHIPPED_SCREEN_DOCS\[machine\.class\]/  const kioskDoc = renderableScreen(publishedScreen.data) ?? demoScreen ?? SHIPPED_SCREEN_DOCS[machine.class] \/\/ MUTANT-W21/' $HMI
measure_pw "W21 kioskDoc priority flipped — a published row outranks the demo document | guards: the three-step order demo > published > shipped, written out in this file's own comment" "MUTANT-W21" "tests/43-editor-acceptance.spec.ts"

perl -0777 -pi -e 's/  const kioskScreenId = screenId === undefined \? machineScreenId\(code\) : undefined/  const kioskScreenId = machineScreenId(code) \/\/ MUTANT-W22/' $HMI
# 🔴 W22 RUNS AGAINST A DEMO-ROUTE SPEC, NOT THE ACCEPTANCE SPEC, AND THE SPEC CHOICE IS THE ROW.
# 43-editor-acceptance never visits /hmi/demo/{screenId} (grepped: the four specs that do are 35, 36,
# 37 and 41), so running this cut there would ask a suite about a route it does not open — a GREEN that
# means "not looked at" reported as a GREEN that means "not pinned". 36-hmi-all-widget-kinds drives the
# demo route directly. The honest expectation is UNKNOWN: `demoScreen` is still FIRST in kioskDoc's
# chain, so the document rendered does not change; what changes is that the demo route now fires a
# doomed GET for machine-<demo code> and gates its first paint on `publishedScreen.isPending`. Whether
# anything measures that is exactly the question.
measure_pw "W22 the demo route stops being excluded from the machine-panel lookup | guards: a URL that NAMES one document is not answered with a different one, and does not wait on a request for a screen it never asked for" "MUTANT-W22" "tests/36-hmi-all-widget-kinds.spec.ts"

perl -0777 -pi -e 's/    enabled: screenId !== undefined && screenId\.length > 0,\r?\n    retry: \(failureCount, error\) =>\r?\n      error instanceof EngineApiError && error\.status === 404 \? false : failureCount < 2,\r?\n  \}\)\r?\n\}/    enabled: screenId !== undefined \&\& screenId.length > 0, \/\/ MUTANT-W23\n  })\n}/s' $API
measure_pw "W23 useScreen retries a confirmed 404 like any other failure | guards: §5-bis — an undeclared screen reaches a NAMED not-found state instead of sitting in isPending through two backoff waits" "MUTANT-W23" "tests/43-editor-acceptance.spec.ts"

perl -0777 -pi -e 's/    mutationFn: \(doc: HmiScreenDocument\) => endpoints\.putScreen\(screenId as string, doc\),\r?\n    onSuccess: \(\) => \{\r?\n      if \(!screenId\) return\r?\n      queryClient\.invalidateQueries\(\{ queryKey: QUERY_KEYS\.screen\(screenId\) \}\)\r?\n      queryClient\.invalidateQueries\(\{ queryKey: QUERY_KEYS\.screenVersions\(screenId\) \}\)/    mutationFn: (doc: HmiScreenDocument) => endpoints.putScreen(screenId as string, doc),\n    onSuccess: () => \{\n      if (!screenId) return \/\/ MUTANT-W24\n      queryClient.invalidateQueries(\{ queryKey: QUERY_KEYS.screen(screenId) \})/s' $API
measure_pw "W24 a publish stops invalidating the VERSION HISTORY key | guards: a publish changes what versions exist as well as what current means — the history the editor lists must move" "MUTANT-W24" "tests/42-editor-publish.spec.ts"

# 🔴 W25 IS THE COMPLEMENT OF W24, NOT A REPEAT, AND IT IS ALSO WHY IT IS NOT "INVALIDATE NOTHING".
# Deleting BOTH invalidations leaves `const queryClient = useQueryClient()` assigned and never read, and
# tsconfig.app.json sets `noUnusedLocals: true` — so that row would report MUTATION DID NOT COMPILE and
# measure nothing at all. Caught in a dry run against a copy before it cost a Playwright boot, which is
# the same lesson the .NET header records twice: a mutation that does not build is not a result.
# So W24 drops the HISTORY key and keeps the document key; W25 drops the DOCUMENT key and keeps the
# history key. Between them every invalidation the two mutations perform is falsified exactly once.
perl -0777 -pi -e 's/    mutationFn: \(toVersion: number\) => endpoints\.rollbackScreen\(screenId as string, toVersion\),\r?\n    onSuccess: \(\) => \{\r?\n      if \(!screenId\) return\r?\n      queryClient\.invalidateQueries\(\{ queryKey: QUERY_KEYS\.screen\(screenId\) \}\)\r?\n/    mutationFn: (toVersion: number) => endpoints.rollbackScreen(screenId as string, toVersion),\n    onSuccess: () => \{\n      if (!screenId) return \/\/ MUTANT-W25\n/s' $API
measure_pw "W25 a rollback stops invalidating the HEAD DOCUMENT key (the history key kept) | guards: a rollback APPENDS a version, so what GET .../{id} now serves has changed and every surface reading the current document must re-read" "MUTANT-W25" "tests/42-editor-publish.spec.ts"

perl -0777 -pi -e 's/  screen: \(screenId: string\) => \["hmi-screen", screenId\] as const,/  screen: (screenId: string) => ["hmi-screen-current", screenId] as const, \/\/ MUTANT-W26/' $API
# 🔴 W26 IS A CONTROL AND IT IS EXPECTED GREEN — the same device as D-0c-1 in the .NET sweep, whose
# label says "known-redundant; expected GREEN". Every consumer reaches this key THROUGH QUERY_KEYS.screen,
# so respelling the string here moves all of them together and nothing observable changes. That is the
# point: a RED here would mean somebody has written the literal ["hmi-screen", id] a second time
# somewhere, which is the drift this indirection exists to prevent. GREEN confirms the single source of
# truth; RED would name the copy. A row whose informative outcome is GREEN has to say so, or the next
# reader files it as a lost pin.
measure_pw "W26 the screen query key is respelled (CONTROL — expected GREEN) | guards: that there is exactly ONE spelling of the key, reached through QUERY_KEYS by every consumer; a RED here names a hardcoded second copy" "MUTANT-W26" "tests/42-editor-publish.spec.ts"

echo "=== web sources restored ==="
