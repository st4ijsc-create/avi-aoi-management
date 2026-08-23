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
#   d. IT DOES NOT CHECK THE OTHER ENUMERATIONS in the file — the Part II and Part III banners have
#      no machine field, and the dozens of preserved quotations inside blockquotes are history, not
#      state. Only the Part I enumeration is pinned, because that is the one that went stale.
#   e. IT SAYS NOTHING ABOUT CORRECTNESS OF A VERDICT, a date, or an attribution.
#
# Usage:  scripts/check-owner-decisions.sh [--file <path>]
# Exit:   0 consistent · 1 divergence(s) found · 2 setup failure
# ═════════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DOC="$(dirname "$HERE")/docs/owner-decisions.md"
[[ "${1:-}" == "--file" ]] && { DOC="${2:-}"; shift 2; }
[[ -r "$DOC" ]] || { echo "check-owner-decisions: cannot read $DOC" >&2; exit 2; }

awk -v DOC="$DOC" '
function strip(s) { gsub(/[*`_~]/, "", s); return s }
function has(s, t) { return index(s, t) > 0 }
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
    cell[n] = strip(line)
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
part == "I" && /^<!-- gate:phần-i/ {
  if (last_enum == 0) { bad(sprintf("C5  line %d: a gate:phần-i marker with no enumeration paragraph above it", FNR)); next }
  if (index($0, "gate:phần-i-rút") > 0) { enum_mark[last_enum] = "RUT" }
  else {
    enum_mark[last_enum] = "LIVE"; live_n++; live_line = FNR
    f = $0; sub(/^<!-- *gate:phần-i *= */, "", f); sub(/ *-->.*$/, "", f)
    live_field = f
  }
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
    c = cell[n]; p = bodypart[n]
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
      bad(sprintf("C5  line %d: a Part I enumeration paragraph that declares neither <!-- gate:phần-i = ... --> nor <!-- gate:phần-i-rút -->. Three of these sit in Part I today and only one is current; a reader cannot tell them apart and neither can a gate.", enum_line[i]))
  if (live_n == 0) bad("C3  no LIVE Part I enumeration: exactly one paragraph must carry <!-- gate:phần-i = <numbers> -->")
  if (live_n > 1)  bad(sprintf("C3  %d LIVE Part I enumerations; there must be exactly one", live_n))

  # 🔴 BF-1 — WHAT THE SUMMARY LINE DECLARES, so that "[]" is not the whole of what a reader gets.
  # BE-1 measured this on four fixtures and found `PART I holds : []` printed IDENTICALLY for the valid
  # empty state and for all three broken ones; the distinction lived entirely in the DIVERGENCES list and
  # the exit code. That is a real defect in a line people grep. `declared_i` is filled below when there is
  # exactly one LIVE field to read, and stays at its "-" sentinel when there is none or more than one —
  # which is precisely the case a bare "[]" could not tell apart. Kept as a SEPARATE variable from `fs_`
  # so the report cannot accidentally print a value C3 never validated.
  declared_i = "-none-"
  if (live_n > 1) declared_i = "-ambiguous(" live_n ")-"

  if (live_n == 1) {
    nf = split(live_field, fa, /[ ,]+/); fs_ = ""
    for (i = 1; i <= nf; i++) if (fa[i] ~ /^[0-9]+$/) fs_ = fs_ (fs_ == "" ? "" : " ") fa[i]
    declared_i = fs_
    if (fs_ != actual)
      bad(sprintf("C3  the machine field (line %d) says [%s]; PART I actually contains [%s]", live_line, fs_, actual))

    # the prose a human reads must name the same set as the field beside it
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
  printf "   PART I holds  : [%s]   (declared: [%s])\n", actual, declared_i
  printf "   PART II holds : [%s]   (declared: [%s])\n", actual_ii, fs2
  # The population protocol verify-suites.sh run_tooling_check enforces. These are the two sets
  # C1-C4 loop over; C0 above refuses on either being empty, and this makes that refusal auditable
  # from OUTSIDE the script rather than only from inside it. Part II is deliberately NOT declared
  # here: it is legitimately empty, and a protocol that demanded otherwise would be demanding a lie.
  # What guards Part II is C6, which asserts an EQUALITY and therefore still says something at zero.
  printf "POPULATION verdict-rows %d\n", length(rowline)
  printf "POPULATION body-sections %d\n", length(bodypart)
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
