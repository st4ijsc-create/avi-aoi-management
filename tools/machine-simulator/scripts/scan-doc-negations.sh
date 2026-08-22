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
#      a preference. `--census` today flags 5780 of 15965 doc-comment sentences — MORE THAN A THIRD
#      OF EVERY DOC SENTENCE IN THE TREE, spread over 481 of 545 files. A gate on that number would
#      be red for any doc edit whatsoever; it would be, in item 26's own words, "a tool with no green
#      definition". The census is a CEILING to be stated, not a threshold to be enforced.
#   d. THE CENSUS POPULATION IS FAR TOO LARGE TO ADJUDICATE IN ONE TASK. 5780 sentences is not a
#      backlog this or any single task can pay. Stated as a ceiling rather than silently narrowed.
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

# Identity is (path, sentence) — line numbers move for reasons that are not claims.
cut -f1,3 "$TMP/now.hits"  | LC_ALL=C sort -u > "$TMP/now.id"
cut -f1,3 "$TMP/base.hits" | LC_ALL=C sort -u > "$TMP/base.id"
LC_ALL=C comm -23 "$TMP/now.id" "$TMP/base.id" > "$TMP/new.id"
NEW=$(grep -c . "$TMP/new.id" || true)

echo "── item 26 · absolute doc claims ADDED since $REF ($SHA) ───────────────────────────────"
echo "── LISTED FIRST; the count is at the bottom and is derived from this list ──────────────"
awk -F'\t' '{printf "  %s\n      %s\n", $1, $2}' "$TMP/new.id"
echo "────────────────────────────────────────────────────────────────────────────────────────"
echo "   NEW absolute doc claims : $NEW"
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
