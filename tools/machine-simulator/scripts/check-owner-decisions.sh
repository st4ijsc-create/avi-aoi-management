#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════════════════════════
# check-owner-decisions.sh — ITEM 37'S INSTRUMENT: THE GATE NOW READS docs/owner-decisions.md.
#
# THE DEFECT, as item 37 records it: "no gate reads this file", so an item could be wrong in ANY
# field — status, number, enumeration — for ANY number of tasks, and the gate stayed GREEN. It did:
# the Part I enumeration listed ELEVEN items that had already moved to Part III, went stale across
# THREE CONSECUTIVE TASKS, and was found only because a human happened to read it for another
# reason. The same class produced an owner ruling (item 16) that lived a whole task cycle with no
# in-place record at all.
#
# WHAT SHAPE THE INSTRUMENT HAD TO TAKE, and item 37 argued this before it was built: making the
# gate parse the PROSE would turn a Vietnamese prose document into schema input, so every rewrite
# could redden the gate — the exact friction item 36 measured on the README, applied to the most
# frequently edited document in the repo. So this pins STRUCTURE, not prose:
#
#   C1  every number in the verdict table has EXACTLY ONE body section, and every body section has
#       exactly one table row  (this is the defect V-1 found by hand: the table was missing two rows)
#   C2  the body sits under the PART HEADING its recorded status requires
#   C3  the LIVE Part I enumeration names exactly the item numbers that are actually in Part I —
#       both in its machine field and in the prose sentence a human reads
#   C4  no item number appears under two part headings
#   C5  every bare Part I enumeration paragraph declares whether it is LIVE or RETRACTED
#   C0  🔴 THE POPULATION IS NON-EMPTY. Added by BA-1 (2026-08-22, item 40) after repo-scan.sh was
#       found shipping item 32's own defect and the other two instruments were swept for the same
#       species. This one HAD it, and it is demonstrable: a file carrying a Part I banner and one
#       LIVE enumeration marker, with NO verdict table and NO body sections, produced
#
#           verdict rows : 0      body sections : 0      DIVERGENCES : 0      exit 0
#
#       Every one of C1–C4 is a FOR-loop over a population this parser recovers from PROSE by
#       regex. An empty population satisfies all of them the way an empty set satisfies any
#       universal claim, so the tool reported CONSISTENT about a file it had read nothing out of.
#       That is the same shape as item 32 — a 0 that means "not measured" wearing the clothes of a
#       0 that means "measured, and clean". The en-dash bug recorded further down is the same
#       parser failing in the LOUD direction; this is it failing in the SILENT one.
#       C0 does not check that the population is the RIGHT size — only that a check ran on
#       something. A table that lost half its rows still passes C0 and is caught, if at all, by C1.
#
# ── HOW STATUS IS READ, AND WHY IT IS NOT "THE FIRST EMOJI IN THE CELL" ──────────────────────────
# The file is append-only by rule: a superseded status is kept VERBATIM, so a single cell can carry
# `🔴 CHỜ ANH` and `✅ ĐÃ THI HÀNH` and `Ở LẠI PHẦN I` at once. Measured across all 37 rows, neither
# "first marker wins" nor "last marker wins" is sound — rows 16, 17 and 27 end with the PRESERVED
# OLD status, and rows 1 and 5-11 begin with a 🔨 they have long since executed. So status is read
# as a SET of tokens plus one rule per part, and each rule is one-directional on purpose:
#
#   Part I   requires  CHỜ ANH   and forbids any execution token
#   Part II  requires  "việc còn nợ" or "Ở LẠI PHẦN II"   and forbids any execution token
#   Part III requires  an execution token   and forbids "THI HÀNH MỘT PHẦN"
#
# 🔴 THE LAST CLAUSE IS THE ONE WITH TEETH AND IT IS DERIVED, NOT INVENTED. Part III's banner reads
# "ĐÃ QUYẾT VÀ ĐÃ THI HÀNH" — decided AND executed. "MỘT PHẦN" says in the record's own words that
# execution is partial, so the entry condition is not met. The file already agrees with this in
# three places: item 12 is headed "PHÁN QUYẾT ĐÃ THI HÀNH MỘT PHẦN" and stays in Part II; item 27
# and item 16 each had a ruling with no execution record and were kept in Part I.
#
# ── WHAT THIS DOES NOT ENFORCE — a ceiling stated too small is worse than no ceiling ─────────────
#   a. 🔴 IT CANNOT CATCH A RULING THAT WAS NEVER WRITTEN DOWN. That is the FIRST half of item 37 —
#      the owner's item-16 ruling reaching an executor only through a gitignored task brief — and no
#      check over this file can see a fact that is not in it. Item 37 says so; building this does
#      not change it. Only the second half, the stale enumeration, is now detected.
#   b. IT DOES NOT READ THE PROSE. A body can say anything; this checks tokens, headings, counts.
#   c. IT CANNOT DECIDE PART I vs PART II for a partially-executed item. It routes such an item to
#      "NOT Part III" and stops. Whether what remains is a DECISION (Part I) or WORK (Part II) is a
#      judgement from the part definitions and stays with the human.
#   d. IT DOES NOT CHECK THE OTHER ENUMERATIONS in the file. 🔴 THIS CLAUSE WAS ITSELF STALE UNTIL
#      BJ-1 (2026-08-23, item 51): it read "the Part II and Part III banners have no machine field",
#      and Part II acquired one — C6 — when BD-1 built it for item 40. The correct ceiling today is
#      narrower AND wider than the old sentence: Part I is pinned by C3 and Part II by C6; PART III
#      AND PART IV ARE NOT PINNED AT ALL, and the dozens of preserved quotations inside blockquotes
#      are history, not state. Found while making these clauses print beside the result, which is
#      the argument for making them print: a ceiling nobody reads is a ceiling nobody corrects.
#   e. IT SAYS NOTHING ABOUT CORRECTNESS OF A VERDICT, a date, or an attribution.
#   f. C0 ASSERTS THE POPULATION IS NON-EMPTY, NOT THAT IT IS THE RIGHT SIZE (this is stated at C0
#      above too; it is repeated in the enumerated list because the list is what gets printed).
#   g. 🔴 C2 IS ONE-DIRECTIONAL BY DESIGN, and item 51 sub-item 2 is about the consequence. It asks
#      "is this body under the part its row's status requires"; it never asks "does this row still
#      carry a status the body has outgrown". It cannot: this file's own rule is that a superseded
#      status is preserved VERBATIM, so a row carrying `Ở LẠI PHẦN II` beside a Part III body is the
#      record working as designed, not a divergence. Making C2 bidirectional would redden rows that
#      are CORRECT, which is the false-positive shape that gets a gate ignored.
#
# Usage:  scripts/check-owner-decisions.sh [--file <path>]
# Exit:   0 consistent · 1 divergence(s) found · 2 setup failure
# ═════════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DOC="$(dirname "$HERE")/docs/owner-decisions.md"

# ══ THE FIXTURE BANK — C2`S TWO SHAPES, BUILT RATHER THAN WAITED FOR ═════════════════════════════
# BQ-1, 2026-08-24, docs/owner-decisions.md item 73.
#
# 🔴 WHY FIXTURES AND NOT AN ASSERTION OVER THE REAL FILE. Item 73 names two shapes. SHAPE A (a
# Part III row quoting its own superseded partial status) has four live examples. SHAPE B (a Part I
# row whose `CHỜ ANH` survives only as preserved history) HAS NONE — item 73`s own words: "chưa có
# ví dụ sống — và vì thế nguy hiểm hơn". A set with no live example is NOT an empty set, and a check
# that waits for one to appear in production is a check that will first fire on a real record on a
# real day. So the example is CONSTRUCTED here, and the construction is the witness.
#
# 🔴 FOUR FIXTURES, TWO OF WHICH MUST NOT MOVE. A bank where every case changes proves only that
# something changed. These are chosen so that two flip and two hold, and the two that hold are the
# ones that make the two that flip mean anything:
#
#   A1  Part III, partial token inside backticks   RED -> GREEN   false positive REMOVED
#   A2  Part III, partial token in live prose      RED -> RED     true positive KEPT (rule 1: it can still go red)
#   B1  Part I,  CHỜ ANH only inside a quotation   GREEN -> RED   Shape B now CAUGHT
#   B2  Part I,  CHỜ ANH bare but superseded       GREEN -> GREEN still blind, and clause (h)/(j) say so
#
# The RED->GREEN and GREEN->RED columns were measured against the checker as it stood at 2530b94c.
if [[ "${1:-}" == "--self-test" ]]; then
  _fixdir="$(dirname "$HERE")/tests/fixtures/owner-decisions"
  _rc=0; _ran=0
  echo "check-owner-decisions --self-test  (C2 shape fixtures, item 73)"
  _expect() {                                  # $1 = fixture basename, $2 = expected exit, $3 = why
    local f="$_fixdir/$1.md" got
    [[ -r "$f" ]] || { echo "FAIL: fixture $1.md is missing from $_fixdir. The bank is the witness; a
      bank that lost a member proves less than it claims and must not pass silently." >&2; _rc=1; return; }
    bash "${BASH_SOURCE[0]}" --file "$f" >/dev/null 2>&1; got=$?
    _ran=$((_ran + 1))
    printf "  %-24s exit=%d  (want %d)  %s\n" "$1" "$got" "$2" "$3"
    [[ "$got" -eq "$2" ]] || { echo "FAIL: fixture $1 exited $got, wanted $2 — $3" >&2; _rc=1; }
  }
  _expect A1-quoted-partial   0 "a QUOTED partial token must not read as a claim"
  _expect A2-asserted-partial 1 "an ASSERTED partial token under Part III must still redden"
  _expect B1-quoted-choanh    1 "Part I with only a quoted CHỜ ANH is item 73 shape B"
  _expect B2-bare-choanh      0 "shape B in bare prose stays undetected — declared, not hidden"
  echo "POPULATION c2-shape-fixtures $_ran"
  echo "DOES-NOT-MEASURE (a) four constructed rows are not the 73 real ones; this pins the SHAPES C2 reads, never that the live record is correct — that is what the main run is for"
  echo "DOES-NOT-MEASURE (b) B2 is asserted GREEN on purpose: item 73 shape B in BARE prose is still invisible to C2 and this bank certifies that it is still invisible, it does not fix it"
  echo "DOES-NOT-MEASURE (c) nothing here touches the CASE hole (rows 12/48/51/52); case-folding was measured at BQ-1 to redden all four even with quotations excised, and was refused for that reason"
  [[ $_rc -eq 0 ]] && echo "PASS: $_ran/4 shape fixtures at their expected verdicts; two flip with the fix and two hold against it."
  exit $_rc
fi

[[ "${1:-}" == "--file" ]] && { DOC="${2:-}"; shift 2; }
[[ -r "$DOC" ]] || { echo "check-owner-decisions: cannot read $DOC" >&2; exit 2; }

awk -v DOC="$DOC" '
function strip(s) { gsub(/[*`_~]/, "", s); return s }
function has(s, t) { return index(s, t) > 0 }

# ══ A TOKEN BEING NAMED IS NOT A TOKEN BEING CLAIMED (BQ-1, 2026-08-24, item 73) ═════════════════
# C2 reads status out of the whole stripped row. This file`s own rule is that a superseded status is
# preserved VERBATIM, and rows routinely QUOTE a status token in order to say something ABOUT it —
# row 73 contains the fragment  has "THI HÀNH MỘT PHẦN" = 0  for the sole purpose of REPORTING THAT
# THE TOKEN IS ABSENT, and C2 read that as the row claiming partial execution. strip() made it
# worse, not better: it deletes the backticks FIRST, destroying the one piece of evidence that told
# a quoted token from an asserted one.
#
# So spans that QUOTE are excised before status is read: backtick code spans and double-quoted
# spans. Everything outside them is the row speaking in its own voice.
#
# 🔴 THE PRICE, MEASURED ON ALL 73 ROWS BEFORE IT WAS WRITTEN, because item 73 records that the
# obvious repair was already priced and REFUSED: BK-1 measured "make C2 bidirectional" at 20 red
# rows out of 58 (34%), 19 of them CORRECT by this file`s rules — a false-positive rate that gets a
# gate ignored, which is rule (2) about a check. This one moves EXACTLY ONE row of 73: row 73, whose
# `partial` goes 1 -> 0. No row changes its execution reading and no row changes its CHỜ ANH
# reading. One row, and it is the known defect.
#
# 🔴 WHAT THIS DOES NOT FIX, stated here because item 73 is only PARTLY paid by it and a ceiling
# stated too small is worse than no ceiling. The CASE hole is untouched. has() is a byte comparison,
# and rows 12, 48, 51 and 52 carry `thi hành một phần` in lower case where `THI HÀNH MỘT PHẦN` would
# redden them; all four are in Part III and all four are green TODAY only because of that spelling.
# Measured at BQ-1: case-folding the partial test reddens exactly those four — AND IT STILL REDDENS
# ALL FOUR WITH THIS EXCISION APPLIED, because their lower-case tokens sit in live prose, not in
# quotations. So excision does not make case-folding safe, the two are independent holes, and this
# change closes one of them. awk`s toupper() cannot be used for the other: it is byte-based, and
# toupper("thi hành một phần") returns "THI HàNH MộT PHầN".
function unquoted(s,   out, i, c, inb, inq, len) {
  out = ""; inb = 0; inq = 0; len = length(s)
  for (i = 1; i <= len; i++) {
    c = substr(s, i, 1)
    if (c == "`")  { inb = !inb; continue }
    if (c == "\"") { inq = !inq; continue }
    if (!inb && !inq) out = out c
  }
  return out
}
function exec_token(s) {
  return has(s, "ĐÃ THI HÀNH") || has(s, "Đã thi hành") || has(s, "đã thi hành") \
      || has(s, "ĐÃ GỠ")      || has(s, "Đã gỡ")       || has(s, "đã gỡ")
}
function bad(msg) { fail[++nfail] = msg }

# `split("", a)` forces ARRAY type. Without it, C0 calling length(rowline) on a file that produced
# no rows types the name as a SCALAR, and the very next `for (n in rowline)` dies with "attempt to
# use scalar as array" — exit 2 instead of the divergence C0 exists to report. Measured on the
# empty-population fixture while adding C0.
BEGIN { FS = "\n"; part = "HEAD"; in_table = 0; split("", rowline); split("", bodypart) }

# ── part banners ──────────────────────────────────────────────────────────────────────────────────
/^# / {
  if      (index($0, "PHẦN I —")   > 0) part = "I"
  else if (index($0, "PHẦN II —")  > 0) part = "II"
  else if (index($0, "PHẦN III —") > 0) part = "III"
  else if (index($0, "PHẦN IV")    > 0) part = "IV"
  else                                  part = "HEAD"
  seen_part[part] = FNR
  next
}

# ── the verdict table: the first pipe table in the header section, nothing else ───────────────────
part == "HEAD" && /^\| *[0-9—-]+ *\|/ {
  in_table = 1
  line = $0
  n = line; sub(/^\| */, "", n); sub(/ *\|.*$/, "", n)
  if (n ~ /^[0-9]+$/) {
    if (n in rowline) bad(sprintf("C1  item %s has TWO rows in the verdict table (lines %d and %d)", n, rowline[n], FNR))
    rowline[n] = FNR
    # `cell` keeps the WHOLE row for anything that wants to read it verbatim; `voice` is the row
    # with its quotations excised, and it is what C2 reads status out of. Kept as two variables so a
    # future check cannot reach for the excised text by accident and lose a token that was real.
    cell[n] = strip(line)
    voice[n] = strip(unquoted(line))
  }
  next
}
part == "HEAD" && in_table && $0 !~ /^\|/ { in_table = 0 }

# ── body sections: "## N." or "## N–M." under a part banner ───────────────────────────────────────
part != "HEAD" && part != "IV" && /^## [0-9]+/ {
  # 🔴 THE RANGE HEADING "## 5–7." USES AN EN DASH (U+2013), WHICH IS THREE BYTES. The first draft
  # of this parser wrote it into a bracket expression `[–—-]`; awk split the multibyte character
  # into bytes and the class never matched, so items 6 and 7 were reported as rows with no body —
  # TWO FALSE DIVERGENCES INVENTED BY THE INSTRUMENT. Caught by re-measuring the output of this
  # script against a hand count of the file. Parsed by position now, with no character class.
  h = $0; sub(/^## /, "", h)
  lo = h; sub(/[^0-9].*$/, "", lo)
  hi = lo
  rest = substr(h, length(lo) + 1)
  if (substr(rest, 1, 1) != ".") {
    seg = rest; sub(/\..*$/, "", seg)
    gsub(/[^0-9]/, " ", seg)
    m = split(seg, ga, / +/)
    for (k = 1; k <= m; k++) if (ga[k] ~ /^[0-9]+$/) hi = ga[k]
  }
  if (hi + 0 < lo + 0 || hi - lo > 20) {
    bad(sprintf("C1  heading at line %d parses to the nonsense range %s..%s — re-read the parser, not the file", FNR, lo, hi))
    hi = lo
  }
  for (i = lo + 0; i <= hi + 0; i++) {
    if (i in bodypart) bad(sprintf("C1/C4  item %d has TWO body sections (part %s line %d, and part %s line %d)", i, bodypart[i], bodyline[i], part, FNR))
    bodypart[i] = part; bodyline[i] = FNR
  }
  next
}

# ── The DECLARED population of Part II, the C6 discriminator (BD-1, 2026-08-23, item 40) ─────────
# C0 asserts the GLOBAL populations are non-empty. It cannot say anything about a PART, and Part II
# went genuinely empty on 2026-08-22 — so "Part II holds nothing because every item was executed"
# and "Part II holds nothing because this parser stopped recognising its bodies" became two states
# with byte-identical observable output: no key with bodypart == "II", no contribution to
# length(bodypart), and the Part-II arm of C2 looping over the empty set. An empty set satisfies
# every universal claim, which is the whole content of item 40, and here it was doing it to the tool
# written to enforce item 37.
#
# The fix is the mechanism Part I has already proved: make the population DECLARED, then assert
# declared == parsed. An equality between two sets is not vacuous when both are empty — it is the
# one form of assertion that still says something there, which is exactly why this shape was chosen
# over "count > 0" (false today, and it would be a lie about a legitimate state).
part == "II" && /^<!-- gate:phần-ii/ {
  ii_n++; ii_line = FNR
  f = $0; sub(/^<!-- *gate:phần-ii *= */, "", f); sub(/ *-->.*$/, "", f)
  ii_field = f
  next
}

# ── Part I enumeration paragraphs, and the machine field that says which one is live ──────────────
part == "I" && /^\*\*Các mục ở đây, LIỆT KÊ/ { enum_n++; enum_line[enum_n] = FNR; enum_text[enum_n] = $0; enum_mark[enum_n] = "" ; last_enum = enum_n; next }

# ══ WHO IS WAITING FOR WHOM — TWO FIELDS, NOT ONE ════════════════════════════════════════════════
# BQ-1, 2026-08-24. COORDINATOR`S RULING of that date, recorded in docs/owner-decisions.md §54.8.
# The single `<!-- gate:phần-i = ... -->` field fused two populations that belong to DIFFERENT
# READERS: items waiting on the OWNER (🔴) and items waiting on the COORDINATOR (⚖️). Part I`s
# banner reads "ĐANG CHỜ ANH" — addressed to the owner — so an owner opening this file was handed a
# list of eighteen numbers of which seven were never theirs, with nothing in the record able to tell
# them which. Item 54 is the case that made it undeniable: §54.7 measured that NOTHING in it waits
# for the owner, and it stayed in Part I anyway because the file had no shelf for "decided by the
# coordinator, not yet decided".
#
# 🔴 THE NAMES ARE DERIVED FROM WHO READS THEM, not from what was convenient to parse. The owner
# greps `chờ-chủ-sở-hữu`; the coordinator greps `chờ-điều-phối-viên`. Each field names its reader in
# the reader`s own words, and each is ONE line, so either can be read without reading the other.
# They sit directly under the LIVE enumeration paragraph — where a reader who has just read the
# prose is already looking — and NOT at the top of the file, because a reader arrives at Part I
# through its banner, not through a table of contents this file does not have.
#
# 🔴 WHAT IS ASSERTED, and why it is a UNION rather than two independent counts: the two fields
# together must be EXACTLY the Part I population, and they must not overlap. An equality against a
# union still says something when one side is empty — the same reasoning C6 is built on — whereas
# two separate "is a subset" checks would both pass while an item fell out of both fields and out of
# anyone`s attention. That silent-drop is the failure this split exists to prevent, so it is the one
# the assertion is aimed at.
part == "I" && /^<!-- gate:phần-i/ {
  if (last_enum == 0) { bad(sprintf("C5  line %d: a gate:phần-i marker with no enumeration paragraph above it", FNR)); next }
  if (index($0, "gate:phần-i-rút") > 0) { enum_mark[last_enum] = "RUT"; next }
  if (index($0, "gate:phần-i-chờ-chủ-sở-hữu") > 0) {
    enum_mark[last_enum] = "LIVE"; owner_n++; owner_line = FNR
    f = $0; sub(/^<!-- *gate:phần-i-chờ-chủ-sở-hữu *= */, "", f); sub(/ *-->.*$/, "", f)
    owner_field = f
    next
  }
  if (index($0, "gate:phần-i-chờ-điều-phối-viên") > 0) {
    enum_mark[last_enum] = "LIVE"; coord_n++; coord_line = FNR
    f = $0; sub(/^<!-- *gate:phần-i-chờ-điều-phối-viên *= */, "", f); sub(/ *-->.*$/, "", f)
    coord_field = f
    next
  }
  # Reached by the RETIRED single-field form `<!-- gate:phần-i = ... -->`. Named rather than ignored:
  # silently accepting it would let a file carry the fused field this ruling replaced and still go
  # green, which is the state the ruling is about.
  bad(sprintf("C7  line %d: an unrecognised gate:phần-i marker. Since 2026-08-24 a LIVE Part I enumeration carries TWO fields — <!-- gate:phần-i-chờ-chủ-sở-hữu = ... --> and <!-- gate:phần-i-chờ-điều-phối-viên = ... --> — and a retracted one carries <!-- gate:phần-i-rút -->. The single fused <!-- gate:phần-i = ... --> form is retired: it could not tell an owner which of these items were theirs", FNR))
  next
}

END {
  # ── C0: the population is non-empty, checked BEFORE the loops that quantify over it ────────────
  # Listed first because every check below is vacuously true on an empty file. See the C0 paragraph
  # in the header for the measurement that put this here.
  if (length(rowline) == 0)
    bad("C0  the verdict table parsed to ZERO rows. Every check below quantifies over that table, so a green here would mean nothing was examined. Either the file is not owner-decisions.md, or the shape of the table changed and this parser stopped recognising it.")
  if (length(bodypart) == 0)
    bad("C0  ZERO body sections parsed under any part banner. Same reason: C1-C4 are loops over this set, and an empty set passes all of them without reading anything.")

  # ── C1: coverage both ways ─────────────────────────────────────────────────────────────────────
  for (n in rowline) if (!(n in bodypart)) bad(sprintf("C1  verdict-table row %s (line %d) has NO body section", n, rowline[n]))
  for (n in bodypart) if (!(n in rowline)) bad(sprintf("C1  body section %d (part %s, line %d) has NO verdict-table row", n, bodypart[n], bodyline[n]))

  # ── C2: the part heading the recorded status requires ──────────────────────────────────────────
  for (n in rowline) {
    if (!(n in bodypart)) continue
    # 🔴 STATUS IS READ FROM THE ROW`S OWN VOICE, NOT FROM ITS QUOTATIONS (item 73). See unquoted().
    c = voice[n]; p = bodypart[n]
    partial = has(c, "THI HÀNH MỘT PHẦN")
    ex = exec_token(c)
    if (p == "I") {
      if (!has(c, "CHỜ ANH")) bad(sprintf("C2  item %s is in PART I but its row (line %d) does not say CHỜ ANH", n, rowline[n]))
      if (ex && !partial)     bad(sprintf("C2  item %s is in PART I but its row (line %d) claims execution", n, rowline[n]))
    } else if (p == "II") {
      if (!(has(c, "việc còn nợ") || has(c, "Ở LẠI PHẦN II")))
        bad(sprintf("C2  item %s is in PART II but its row (line %d) records no outstanding work", n, rowline[n]))
      if (ex && !partial)     bad(sprintf("C2  item %s is in PART II but its row (line %d) claims execution", n, rowline[n]))
    } else if (p == "III") {
      if (!ex)      bad(sprintf("C2  item %s is in PART III but its row (line %d) records no execution", n, rowline[n]))
      if (partial)  bad(sprintf("C2  item %s is in PART III (\"ĐÃ QUYẾT VÀ ĐÃ THI HÀNH\") but its row (line %d) says THI HÀNH MỘT PHẦN — partial execution does not meet that entry condition. It belongs in PART I if what remains is a DECISION, in PART II if what remains is WORK; this check does not choose between them.", n, rowline[n]))
    }
  }

  # ── C3/C5: the Part I enumeration ──────────────────────────────────────────────────────────────
  actual = ""
  for (n = 1; n <= 999; n++) if ((n in bodypart) && bodypart[n] == "I") actual = actual (actual == "" ? "" : " ") n

  if (enum_n == 0) bad("C3  PART I has no enumeration paragraph at all")
  for (i = 1; i <= enum_n; i++)
    if (enum_mark[i] == "")
      bad(sprintf("C5  line %d: a Part I enumeration paragraph that declares neither the two LIVE fields nor <!-- gate:phần-i-rút -->. Three of these sit in Part I today and only one is current; a reader cannot tell them apart and neither can a gate.", enum_line[i]))

  # C7 — exactly one of each field. Two separate counts and two separate messages, because "the
  # owner cannot find their list" and "the coordinator cannot find theirs" are different failures
  # for different people, and a single merged complaint would name neither.
  if (owner_n == 0) bad("C7  no LIVE <!-- gate:phần-i-chờ-chủ-sở-hữu = <numbers> --> field. Part I`s banner is addressed to the owner; without this field the owner cannot tell which of these items are theirs to decide, which is the defect the 2026-08-24 coordinator ruling exists to close")
  if (owner_n > 1)  bad(sprintf("C7  %d gate:phần-i-chờ-chủ-sở-hữu fields; there must be exactly one", owner_n))
  if (coord_n == 0) bad("C7  no LIVE <!-- gate:phần-i-chờ-điều-phối-viên = <numbers, possibly none> --> field. An EMPTY declaration is the assertion that nothing waits on the coordinator; its ABSENCE is the defect, exactly as for the Part II field C6 guards")
  if (coord_n > 1)  bad(sprintf("C7  %d gate:phần-i-chờ-điều-phối-viên fields; there must be exactly one", coord_n))

  # 🔴 BF-1 — WHAT THE SUMMARY LINE DECLARES, so that "[]" is not the whole of what a reader gets.
  # BE-1 measured this on four fixtures and found `PART I holds : []` printed IDENTICALLY for the valid
  # empty state and for all three broken ones; the distinction lived entirely in the DIVERGENCES list and
  # the exit code. That is a real defect in a line people grep. `declared_i` is filled below when there is
  # exactly one LIVE field to read, and stays at its "-" sentinel when there is none or more than one —
  # which is precisely the case a bare "[]" could not tell apart. Kept as a SEPARATE variable from `fs_`
  # so the report cannot accidentally print a value C3 never validated.
  declared_owner = "-none-"; declared_coord = "-none-"; declared_i = "-none-"
  if (owner_n > 1) declared_owner = "-ambiguous(" owner_n ")-"
  if (coord_n > 1) declared_coord = "-ambiguous(" coord_n ")-"

  if (owner_n == 1 && coord_n == 1) {
    nf = split(owner_field, fa, /[ ,]+/); o_set = ""
    for (i = 1; i <= nf; i++) if (fa[i] ~ /^[0-9]+$/) { o_set = o_set (o_set == "" ? "" : " ") fa[i]; in_owner[fa[i]] = 1 }
    nf = split(coord_field, fb, /[ ,]+/); c_set = ""
    for (i = 1; i <= nf; i++) if (fb[i] ~ /^[0-9]+$/) { c_set = c_set (c_set == "" ? "" : " ") fb[i]; in_coord[fb[i]] = 1 }
    declared_owner = o_set; declared_coord = c_set

    # THE UNION, rebuilt in ascending order so it is comparable to `actual` as a string rather than
    # by set arithmetic the report could not then print.
    both = ""; union = ""
    for (n = 1; n <= 999; n++) {
      if ((n in in_owner) && (n in in_coord)) both = both (both == "" ? "" : " ") n
      if ((n in in_owner) || (n in in_coord)) union = union (union == "" ? "" : " ") n
    }
    declared_i = union

    if (both != "")
      bad(sprintf("C7  item(s) [%s] are declared in BOTH the owner field (line %d) and the coordinator field (line %d). An item waits on ONE of them; if it genuinely needs both, it is two items and the record should say so", both, owner_line, coord_line))
    if (union != actual)
      bad(sprintf("C7  the UNION of the two machine fields (lines %d and %d) is [%s]; PART I actually contains [%s]. An item in neither field is in nobody`s queue — that is the silent drop this split exists to prevent", owner_line, coord_line, union, actual))

    # the prose a human reads must name the same set as the fields beside it
    for (i = 1; i <= enum_n; i++) if (enum_mark[i] == "LIVE") {
      t = enum_text[i]; sub(/^.*LIỆT KÊ chứ không đếm: */, "", t); sub(/\*\*.*$/, "", t)
      gsub(/mục|và|\./, " ", t)
      np = split(t, pa, /[ ,]+/); ps = ""
      for (j = 1; j <= np; j++) if (pa[j] ~ /^[0-9]+$/) ps = ps (ps == "" ? "" : " ") pa[j]
      if (ps != actual)
        bad(sprintf("C3  the PROSE enumeration (line %d) names [%s]; PART I actually contains [%s]", enum_line[i], ps, actual))
    }
  }

  # ── C6: the declared population of Part II must equal its parsed one ───────────────────────────
  actual_ii = ""
  for (n = 1; n <= 999; n++) if ((n in bodypart) && bodypart[n] == "II") actual_ii = actual_ii (actual_ii == "" ? "" : " ") n

  if (ii_n == 0)
    bad("C6  PART II declares no population. Exactly one <!-- gate:phần-ii = <numbers, possibly none> --> must sit under the Part II banner. Without it an EMPTY Part II and a Part II whose bodies this parser stopped recognising produce identical output, and so does a Part II banner that no longer matches at all -- in which case its items are silently attributed to Part I. The empty declaration is the assertion; its absence is the defect.")
  else if (ii_n > 1)
    bad(sprintf("C6  %d gate:phần-ii declarations under PART II; there must be exactly one", ii_n))
  else {
    nf2 = split(ii_field, fb, /[ ,]+/); fs2 = ""
    for (i = 1; i <= nf2; i++) if (fb[i] ~ /^[0-9]+$/) fs2 = fs2 (fs2 == "" ? "" : " ") fb[i]
    if (fs2 != actual_ii)
      bad(sprintf("C6  the PART II machine field (line %d) declares [%s]; PART II actually contains [%s]. If an item was just executed, move the field with it; if the field is right, this parser has lost sight of a body that is still there.", ii_line, fs2, actual_ii))
  }

  # ── report ─────────────────────────────────────────────────────────────────────────────────────
  printf "── item 37 · owner-decisions.md structural check ───────────────────────────────────────\n"
  printf "   file          : %s\n", DOC
  printf "   verdict rows  : %d      body sections : %d\n", length(rowline), length(bodypart)
  # 🔴 BF-1 — the Part I line now carries its DECLARED field, exactly as the Part II line below always
  # has. That asymmetry WAS the defect: at zero items "[%s]" collapses to "[]" for four different states
  # (legitimately empty; banner broken so nothing parses; machine field missing; two machine fields), and
  # a reader — or a grep — saw one string for all four. With the declaration beside it the valid empty
  # state prints "[]   (declared: [])", an EQUALITY at zero, which is exactly what C3 asserts; a broken
  # banner prints "(declared: -none-)"; two fields print "(declared: -ambiguous(2)-)"; and a stale field
  # prints its own contents. It does NOT replace the DIVERGENCES list or the exit code and is not asked
  # to — this is a line a human reads, and the repair is that it now says different things about cases
  # that differ.
  printf "   PART I holds  : [%s]   (declared union: [%s])\n", actual, declared_i
  # 🔴 The split printed where the result is read, not only asserted (coordinator`s ruling of
  # 2026-08-24). An owner scanning this output for "what is mine" reads ONE line and stops; before
  # this, the only line available named all eighteen and left the sorting to them.
  printf "     ⏳ waiting on the OWNER       : [%s]\n", declared_owner
  printf "     ⚖️  waiting on the COORDINATOR : [%s]\n", declared_coord
  printf "   PART II holds : [%s]   (declared: [%s])\n", actual_ii, fs2
  # The population protocol verify-suites.sh run_tooling_check enforces. These are the two sets
  # C1-C4 loop over; C0 above refuses on either being empty, and this makes that refusal auditable
  # from OUTSIDE the script rather than only from inside it. Part II is deliberately NOT declared
  # here: it is legitimately empty, and a protocol that demanded otherwise would be demanding a lie.
  # What guards Part II is C6, which asserts an EQUALITY and therefore still says something at zero.
  printf "POPULATION verdict-rows %d\n", length(rowline)
  printf "POPULATION body-sections %d\n", length(bodypart)
  # The disclosure protocol (verify-suites.sh run_tooling_check, docs/owner-decisions.md item 51).
  # The "WHAT THIS DOES NOT ENFORCE" block at the top of this file is correct, careful, and was
  # invisible: the gate printed "owner-decisions structure: OK" and not one of its clauses. Item 51
  # names that as a live defect. These are the same clauses a-e, one line each, plus the two the
  # header states elsewhere (C0s size blindness and C2s one-directionality), at the place the
  # result is read. Compressed, not softened — if a clause here is weaker than the header, the
  # header is the record and this is the bug.
  printf "DOES-NOT-MEASURE (a) it cannot see a ruling that was never written into this file — item 37s first half is untouched by this check\n"
  printf "DOES-NOT-MEASURE (b) it does not read the PROSE; a body may say anything. Tokens, headings and counts only\n"
  printf "DOES-NOT-MEASURE (c) it cannot decide Part I vs Part II for a partially-executed item; it routes to NOT-Part-III and stops\n"
  printf "DOES-NOT-MEASURE (d) it pins ONLY the Part I and Part II enumerations; Part III and Part IV have no machine field and are unchecked\n"
  printf "DOES-NOT-MEASURE (e) it says nothing about whether a verdict, a date or an attribution is CORRECT\n"
  printf "DOES-NOT-MEASURE (f) C0 asserts the population is non-empty, NOT that it is the right size; a table that lost half its rows still passes C0\n"
  printf "DOES-NOT-MEASURE (g) C2 is ONE-DIRECTIONAL by design: it asks whether the body sits under the part its row status requires, never whether the row still carries a status the body has outgrown. This file keeps superseded statuses VERBATIM, so a row reading %s beside a Part III body is the record working as designed, not a divergence (item 51 sub-item 2)\n", "Ở LẠI PHẦN II"
  printf "DOES-NOT-MEASURE (h) C2 reads status from the row with QUOTED spans excised (backticks and double quotes), so a token being NAMED no longer reads as a token being CLAIMED — but the CASE hole is untouched: has() compares bytes, rows 12/48/51/52 carry `thi hành một phần` in lower case, and all four are green because of that spelling and not because of anything this check verified (item 73, partly paid)\n"
  printf "DOES-NOT-MEASURE (i) the excision in (h) cuts BOTH ways and nothing here detects the other one: a row that writes its LIVE status inside backticks or quotes would have that status excised too, and C2 would report it missing. No row does this today (measured on all %d rows at BQ-1), which is a fact about today, not a property of the check\n", length(rowline)
  printf "DOES-NOT-MEASURE (j) the two Part I fields assert WHO IS WAITING, never whether that attribution is RIGHT. An item parked under the owner that the coordinator could decide — item 54`s exact shape before 2026-08-24 — satisfies C7 completely; only a human re-reading the three exemptions can catch it (item 49 §49.5)\n"
  printf "── DIVERGENCES LISTED FIRST; the count is derived from this list ───────────────────────\n"
  for (i = 1; i <= nfail; i++) printf "   %2d. %s\n", i, fail[i]
  if (nfail == 0) printf "   (none)\n"
  printf "────────────────────────────────────────────────────────────────────────────────────────\n"
  printf "   DIVERGENCES : %d\n", nfail
  if (nfail > 0) {
    printf "   🔴 Each one is a finding about the RECORD. Fix the record; do not fit the tool to it.\n"
    exit 1
  }
  exit 0
}
' "$DOC"
