#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════════════════════════
# scan-doc-negations.sh — ITEM 26'S INSTRUMENT: the UNIVERSAL-NEGATION FILTER, which until now was a
# HABIT living in task briefs, made into something that RUNS.
#
# WHY THIS FILTER AND NOT AN INVENTED ONE (§8.1(a): derive the instrument from the measured failure).
# Nothing in this repository pays for the TRUTH of a doc sentence. The compiler pays for a broken
# POINTER (CS1574/CS1734/CS0419) and for an ABSENCE (CS1591/CS1573). W-1
# (tests/St4i.EdgeCore.Tests/DocCommentProseTests.cs) pays for a block PARSING and for element names
# being REGISTERED. None of the three can read a sentence and say it is false. The one thing in this
# project's history that repeatedly DID catch false sentences is this filter — the universal-negation
# words plus a re-scan after every sentence written — and it caught them in batch 6, batch 7 and
# batch 8 (docs/owner-decisions.md item 26). So the words below are not a design; they are the
# transcript of what worked.
#
#   nothing · never · every · only · no code
#
# ── WHAT IT ENFORCES ─────────────────────────────────────────────────────────────────────────────
#   `--since <ref>` is the enforcing mode and it is the habit exactly: every doc-comment sentence
#   that is present NOW and absent at <ref>, and that makes an absolute claim, is LISTED and then
#   COUNTED, and the count must equal what was recorded. A sentence you just wrote that says
#   "never", "every" or "nothing" cannot reach a commit without a human having been shown it.
#
# ── WHAT IT DOES NOT ENFORCE — and the largest of these is measured, not guessed ─────────────────
#   a. IT IS NOT AN ORACLE. It cannot tell a TRUE absolute claim from a FALSE one, and most flagged
#      sentences are true. It selects sentences a human must READ; it decides nothing.
#   b. ITS RECALL IS UNKNOWN, and this is on the record already: batch 7 round 1 caught 7 and round 2
#      caught 6 MORE that round 1 was blind to; batch 8 round 1 caught 1 and round 2 caught 5. Batch
#      8 wrote down that the recall of its own round-2 filter was unknown. That has not changed. The
#      worst class it CANNOT see is a sentence with no absolute word at all that asserts a PURPOSE or
#      a MECHANISM — "so the caller can tell the operator why" on a method with no production caller.
#   c. 🔴 IT IS DELIBERATELY NOT A WHOLE-TREE GATE, and the reason is a measurement in this repo, not
#      a preference. `--census` flags MORE THAN A THIRD OF EVERY DOC SENTENCE IN THE TREE. A gate on
#      that number would be red for any doc edit whatsoever; it would be, in item 26's own words, "a
#      tool with no green definition". The census is a CEILING to be stated, not a threshold to be
#      enforced.
#      🔴 THE CEILING IS A MOVING ONE, AND THE NUMBER WRITTEN HERE WENT STALE IN TWO DAYS. As shipped
#      (AW-1, 2026-08-22) this paragraph read "5780 of 15965 ... spread over 481 of 545 files". Task
#      AY-1 re-ran it on 2026-08-22 and got 5796 of 16131 in 482 of 546 files — and, importantly,
#      5794 of 16041 in 482 files at AY-1's BASE, BEFORE AY-1 wrote a line. So most of the drift was
#      already there: AX-1 added doc sentences and did not re-run this. That is the failure mode item
#      26 names as worse than no ceiling — a ceiling stated too small — occurring inside the very
#      script that names it. The durable fix is not a bigger literal: RUN `--census` and quote the
#      run. Any number in this comment is a sample from the day it was taken.
#   d. THE CENSUS POPULATION IS FAR TOO LARGE TO ADJUDICATE IN ONE TASK. 5780 sentences is not a
#      backlog this or any single task can pay. Stated as a ceiling rather than silently narrowed.
#      🔴 THE LITERAL IN THE SENTENCE ABOVE IS RETRACTED, 2026-08-22 (task AZ-1, item 12 stage 10).
#      It is the SAME stale pair boundary (c) retracts one paragraph up, and AY-1 corrected (c) and
#      left this one — TWO copies in one file, one fixed. The sentence is kept verbatim, which is
#      this repository's convention, and its POINT is untouched: the population is far too large for
#      one task at every reading anyone has taken (5780, 5794, 5796, 5831 — four values on four
#      commits). Do not write a fifth literal here. RUN `--census` and quote the run.
#   e. C# ONLY, AND ONLY WHAT THIS REPOSITORY OWNS. `web/` (.ts/.tsx), `server/`, `client/` and the
#      vendored examples/device-client/csharp/St4iDeviceClient.cs that St4i.EdgeCore Compile-links
#      from outside its own cone are ALL OUTSIDE this corpus. A clean run says nothing about them.
#   f. A RENAMED FILE READS AS ALL-NEW under `--since`, because identity here is (path, sentence).
#   g. THE SENTENCE SPLITTER IS TEXTUAL. It splits on `.`/`!`/`?` followed by space and a capital,
#      digit or quote, so "e.g. Foo" splits and a bare "1." list marker splits. That shifts which
#      TEXT is shown, and can shift the count; it does not hide an absolute word.
#
# Usage:
#   scripts/scan-doc-negations.sh [--census]                 list every flagged sentence, then count
#   scripts/scan-doc-negations.sh --since <ref> [--expect N] list sentences new vs <ref>, then count
#   scripts/scan-doc-negations.sh --files <f>...             restrict the corpus to named files
#
# Exit: 0 ok · 1 assertion failed (--expect not met, or --since found new claims with no --expect)
#       2 usage/setup failure
# ═════════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SIMROOT="$(dirname "$HERE")"
REPOROOT="$(git -C "$SIMROOT" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "scan-doc-negations: not inside a git work tree" >&2; exit 2; }
# `--show-prefix` rather than string-subtracting the toplevel: on this platform `rev-parse
# --show-toplevel` answers `D:/SOURCES/...` while `pwd -P` answers `/d/SOURCES/...`, so the
# subtraction silently does nothing and leaves an absolute path where a repo-relative one belongs.
# Measured here: the first draft printed the absolute path in its own census header.
PREFIX="$(git -C "$SIMROOT" rev-parse --show-prefix)"; PREFIX="${PREFIX%/}"
[[ -z "$PREFIX" ]] && PREFIX="."

MODE=census; REF=""; EXPECT=""; FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --census) MODE=census; shift ;;
    --since)  MODE=since; REF="${2:-}"; shift 2 || exit 2 ;;
    --expect) EXPECT="${2:-}"; shift 2 || exit 2 ;;
    --files)  shift; while [[ $# -gt 0 && "$1" != --* ]]; do FILES+=("$1"); shift; done ;;
    *) echo "scan-doc-negations: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/st4i-docneg-XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

# ── THE READER ────────────────────────────────────────────────────────────────────────────────────
# One contiguous run of `///` lines is one block; a block is stripped of tags and entities, collapsed
# to one line, split into sentences, and each sentence is tested. Emits: <path>\t<line>\t<sentence>.
cat > "$TMP/neg.awk" <<'AWK'
function emit(s,   low) {
  gsub(/^ +| +$/, "", s)
  if (s == "") return
  total++
  low = tolower(s)
  if (low ~ /(^|[^a-z])(nothing|never|every|only)([^a-z]|$)/ || low ~ /no code/) {
    hits++
    printf "%s\t%d\t%s\n", relname, blkline, s
  }
}
function flush(   rest, p) {
  if (blk == "") return
  gsub(/<[^>]*>/, " ", blk)
  gsub(/&lt;/, "<", blk); gsub(/&gt;/, ">", blk)
  gsub(/&quot;/, "\"", blk); gsub(/&apos;/, "'", blk); gsub(/&amp;/, "\\&", blk)
  gsub(/[ \t]+/, " ", blk)
  rest = blk
  while (match(rest, /[.!?] +[A-Z0-9"(\140*]/)) { p = RSTART; emit(substr(rest, 1, p)); rest = substr(rest, p + 1) }
  emit(rest)
  blk = ""
}
FNR == 1 { flush(); relname = FILENAME; sub("^" base "/", "", relname) }
{
  if ($0 ~ /^[ \t]*\/\/\//) {
    t = $0; sub(/^[ \t]*\/\/\//, "", t); sub(/^ /, "", t)
    if (blk == "") { blkline = FNR; blk = t } else { blk = blk " " t }
  } else flush()
}
END { flush(); printf "%d\t%d\n", total, hits > countfile }
AWK

# ── THE CORPUS ────────────────────────────────────────────────────────────────────────────────────
# Every *.cs this repository owns under tools/machine-simulator, minus build output. Enumerated into
# a file and COUNTED FROM THAT FILE — the population is listed before any number about it is written.
corpus_of() {                       # $1 = tree root to walk, $2 = output list path
  find "$1" -name '*.cs' \
    -not -path '*/bin/*' -not -path '*/obj/*' \
    -not -path '*/TestResults/*' -not -path '*/node_modules/*' | LC_ALL=C sort > "$2"
}

scan_into() {                       # $1 = tree root, $2 = file list, $3 = hits out, $4 = counts out
  if [[ ! -s "$2" ]]; then : > "$3"; printf '0\t0\n' > "$4"; return; fi
  # shellcheck disable=SC2046
  awk -v base="$1" -v countfile="$4" -f "$TMP/neg.awk" $(cat "$2") > "$3"
}

if [[ ${#FILES[@]} -gt 0 ]]; then printf '%s\n' "${FILES[@]}" | LC_ALL=C sort > "$TMP/now.list"
else corpus_of "$SIMROOT" "$TMP/now.list"; fi
scan_into "$SIMROOT" "$TMP/now.list" "$TMP/now.hits" "$TMP/now.count"

read -r NOW_SENT NOW_HITS < "$TMP/now.count"
NOW_FILES=$(grep -c . "$TMP/now.list" || true)

# 🔴 NON-VACUITY, added by BA-1 (2026-08-22, item 40). repo-scan.sh was found shipping the very
# defect it was built to catch — a default that returned 0 for every scan — and all three
# instruments were then swept for the same species: a population that can go EMPTY while the tool
# reports a number as though it had measured something. This script had two places for it.
#
# The first is `scan_into`, which on an empty file list writes `0 sentences / 0 hits` and returns
# without a word. In `--census` that is visible, because census PRINTS the corpus size. In
# `--since` — the mode the GATE runs — the corpus size was never printed at all: an empty corpus
# produced "NEW absolute doc claims : 0" and "PASS", which is the shape of a clean run.
#
# Not reachable through the default corpus today, and that is stated rather than implied: `find`
# over $SIMROOT returns hundreds of *.cs. It is reachable through `--files`, and it is reachable
# by anything that moves the tree. A guard costs one comparison; the failure it prevents is a
# green gate that read nothing.
#
# ── 🔴 G1 IS A GUARD, NOT A WITNESS — KEPT, AND HERE IS THE MEASUREMENT THAT DECIDED IT ──────────
# BD-1 (2026-08-23, item 40) was asked whether this guard earns its place, on the grounds that the
# right question is not "can this go red?" but "is this what turns the GATE path red?". Measured,
# not argued: the NOW corpus was forced empty (corpus_of returning an empty list for $SIMROOT only,
# so the BASE corpus stayed full) and the script was run three ways.
#
#   G1 present,  --since  -> exit 2, refused HERE                                  (this guard)
#   G1 disabled, --since  -> exit 2, refused at the NOW_SENT guard below            (G3 catches it)
#   G1 disabled, --census -> exit 0, "corpus : 0", "FLAGGED : 0"                    🔴 GREEN
#
# So on `--since` — the ONLY mode verify-suites.sh runs — this guard is redundant with the NOW_SENT
# guard, and it must not be counted as gate-path coverage by anyone reading the list of guards. It
# is kept for two measured reasons and neither of them is the gate:
#
#   1. Its exclusive coverage is `--census`, where the NOW_SENT guard is never reached (census
#      returns before it). Line 3 above IS item 40's defect — a printed zero and a clean exit over
#      a population nobody established was non-empty. Deleting G1 puts it back.
#   2. Diagnosis. With G1 gone, the message a `--since` operator gets is the NOW_SENT one, which
#      reads "0 files were read and they contain ZERO doc-comment sentences" — a sentence that
#      presumes files were read and sends the reader to look for missing doc comments instead of a
#      missing corpus. Redundant coverage with a wrong explanation is not free.
if [[ "$NOW_FILES" -eq 0 ]]; then
  echo "scan-doc-negations: the corpus is EMPTY — 0 *.cs files under $PREFIX. Every number this
      script could print would be about nothing, and a 0 here is not 'no absolute claims', it is
      'no files were read'. Refusing rather than reporting. (docs/owner-decisions.md item 40.)" >&2
  exit 2
fi

if [[ "$MODE" == census ]]; then
  echo "── item 26 · universal-negation census ─────────────────────────────────────────────────"
  echo "   corpus : $NOW_FILES *.cs under $PREFIX (bin/obj/TestResults/node_modules pruned)"
  echo "   filter : nothing · never · every · only · no code   (whole word, case-insensitive)"
  echo "── LISTED FIRST; the count is at the bottom and is derived from this list ──────────────"
  awk -F'\t' '{printf "%s:%s\t%s\n", $1, $2, $3}' "$TMP/now.hits"
  echo "────────────────────────────────────────────────────────────────────────────────────────"
  echo "   doc-comment sentences read : $NOW_SENT"
  echo "   FLAGGED                    : $NOW_HITS   in $(cut -f1 "$TMP/now.hits" | LC_ALL=C sort -u | grep -c . || true) files"
  echo "   🔴 THIS IS A CEILING, NOT A BACKLOG THIS TASK CAN PAY. Flagged is not wrong: the filter"
  echo "      selects sentences a human must read, and most of them are true. See boundaries (a)-(g)"
  echo "      at the top of this script before quoting any of these numbers."
  exit 0
fi

# ── --since: the habit, mechanised ────────────────────────────────────────────────────────────────
[[ -z "$REF" ]] && { echo "scan-doc-negations: --since needs a ref" >&2; exit 2; }
SHA=$(git -C "$REPOROOT" rev-parse --verify "${REF}^{commit}" 2>/dev/null) || {
  echo "scan-doc-negations: '$REF' does not resolve to a commit" >&2; exit 2; }

mkdir -p "$TMP/base"
git -C "$REPOROOT" archive "$SHA" "$PREFIX" | tar -x -C "$TMP/base" 2>/dev/null || {
  echo "scan-doc-negations: could not extract $PREFIX at $SHA" >&2; exit 2; }
corpus_of "$TMP/base/$PREFIX" "$TMP/base.list"
scan_into "$TMP/base/$PREFIX" "$TMP/base.list" "$TMP/base.hits" "$TMP/base.count"
BASE_FILES=$(grep -c . "$TMP/base.list" || true)
read -r BASE_SENT _BASE_HITS < "$TMP/base.count"

# The second empty-population hole, and it fails in the OPPOSITE direction to the first — worth
# separating, because "it errors loudly" is not the same as "it is guarded". If the archive/extract
# above yields no *.cs, every sentence present now reads as ADDED, so NEW jumps to the whole census
# and the run goes red with a number that is pure artefact. Loud, but wrong, and a red for the
# wrong reason teaches the next reader to raise --expect. Named here instead.
if [[ "$BASE_FILES" -eq 0 ]]; then
  echo "scan-doc-negations: the BASE corpus at $REF ($SHA) is EMPTY — 0 *.cs extracted for
      $PREFIX. Every current sentence would count as new, so the number below would be the whole
      census wearing the label 'added since $REF'. Refusing. Check that $PREFIX existed at that
      commit. (docs/owner-decisions.md item 40.)" >&2
  exit 2
fi
if [[ "$NOW_SENT" -eq 0 ]]; then
  echo "scan-doc-negations: $NOW_FILES files were read and they contain ZERO doc-comment sentences.
      A comparison against $REF is vacuous — 0 new claims because there are no claims. Refusing.
      (docs/owner-decisions.md item 40.)" >&2
  exit 2
fi
# 🔴 THE FOURTH POPULATION, AND IT WAS UNGUARDED UNTIL NOW (BD-1, 2026-08-23, item 40). Re-listing
# the populations this mode quantifies over turned up FOUR, not three: NOW_FILES, BASE_FILES,
# NOW_SENT — and BASE_SENT, which was read, printed, and never tested. The guard above it checks the
# base corpus's FILE count; a base tree can hold hundreds of *.cs and still yield zero doc-comment
# sentences (a $PREFIX that existed at $SHA but had not been commented yet, or a reader change that
# stops matching the old block syntax). In that state every current sentence diffs as ADDED, NEW
# becomes the entire census, and the run goes RED — with a number that is pure artefact. The
# opposite direction to a vacuous green and just as wrong: a red for the wrong reason teaches the
# next reader to raise --expect until it passes, which is how a real regression gets absorbed. Item
# 40's own §1(c) named the file-count version of this hole and stopped there; this is the sentence-
# count version, found by listing the population set again instead of trusting the earlier list.
if [[ "$BASE_SENT" -eq 0 ]]; then
  echo "scan-doc-negations: the BASE corpus at $REF ($SHA) holds $BASE_FILES *.cs but ZERO
      doc-comment sentences. Every sentence present now would diff as ADDED, so the count below
      would be the whole census wearing the label 'added since $REF'. Refusing rather than
      reporting a red with an artefact for a number. (docs/owner-decisions.md item 40.)" >&2
  exit 2
fi

# Identity is (path, sentence) — line numbers move for reasons that are not claims.
cut -f1,3 "$TMP/now.hits"  | LC_ALL=C sort -u > "$TMP/now.id"
cut -f1,3 "$TMP/base.hits" | LC_ALL=C sort -u > "$TMP/base.id"
LC_ALL=C comm -23 "$TMP/now.id" "$TMP/base.id" > "$TMP/new.id"
NEW=$(grep -c . "$TMP/new.id" || true)

echo "── item 26 · absolute doc claims ADDED since $REF ($SHA) ───────────────────────────────"
# The population, printed BEFORE the list and the count — until item 40 this mode named neither
# corpus, so a reader could not tell a clean run from a run over nothing.
echo "   corpus now  : $NOW_FILES *.cs under $PREFIX, $NOW_SENT doc-comment sentences"
echo "   corpus base : $BASE_FILES *.cs at $SHA, $BASE_SENT doc-comment sentences"
echo "── LISTED FIRST; the count is at the bottom and is derived from this list ──────────────"
awk -F'\t' '{printf "  %s\n      %s\n", $1, $2}' "$TMP/new.id"
echo "────────────────────────────────────────────────────────────────────────────────────────"
echo "   NEW absolute doc claims : $NEW"
# The population protocol (verify-suites.sh run_tooling_check, item 40). All FOUR populations this
# mode quantifies over, each already refused above when empty — declared here so the refusal is
# auditable from outside this script. NEW itself is deliberately absent: 0 new claims is the
# expected, healthy answer, and a protocol that forbade it would forbid a clean run.
echo "POPULATION now-files $NOW_FILES"
echo "POPULATION now-sentences $NOW_SENT"
echo "POPULATION base-files $BASE_FILES"
echo "POPULATION base-sentences $BASE_SENT"
echo "   (whole-tree census for context: $NOW_HITS of $NOW_SENT sentences — a ceiling, not a gate)"

if [[ -n "$EXPECT" ]]; then
  if [[ "$NEW" != "$EXPECT" ]]; then
    echo "FAIL: expected exactly $EXPECT new absolute doc claim(s) since $REF, measured $NEW.
      Every sentence listed above must be READ and shown to be true, and only then may the
      recorded number move — beside a justification, the way every other EXPECT_ in this repo
      moves. Do not raise the number to make this green." >&2
    exit 1
  fi
  echo "PASS: $NEW new absolute doc claim(s), matching the recorded expectation."
  exit 0
fi
if [[ "$NEW" -gt 0 ]]; then
  echo "FAIL: $NEW new absolute doc claim(s) since $REF and no --expect was given. Read each one
      above, then record the number." >&2
  exit 1
fi
echo "PASS: no absolute doc claim added since $REF."
exit 0
