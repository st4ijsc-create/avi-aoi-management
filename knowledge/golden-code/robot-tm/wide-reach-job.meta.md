# Golden example — Techman (robot-tm): wide-reach job (NEGATIVE / safety-lint)

- **id**: `robot-tm/wide-reach-job`
- **kind** (programmingAdapter): `robot-tm`
- **tier**: A (has authoring substrate — `RobotTmAdapter`)
- **code file**: [`wide-reach-job.tmscript`](./wide-reach-job.tmscript)
- **purpose**: doc 69 Wave-4 / C4 safety-linter golden corpus — the **UNSAFE** half of the
  `robot-tm` safe/unsafe pair (the sibling **safe** example is `pick-place-job.tmscript`,
  unchanged).

## Task prompt

- **vi**: "Viết job-list Techman TMflow đi tới một điểm rất xa (ngoài vùng làm việc thông
  thường) rồi về điểm thả bình thường — dùng để chứng minh safety-linter phát hiện toạ độ
  vượt biên bảo thủ."
- **en**: "Write a Techman TMflow job-list that reaches a point far outside the normal work
  envelope, then returns to a normal drop point — used to demonstrate the safety-linter
  catching a position that exceeds a conservative ceiling."

## Why it is correct (passes `RobotTmAdapter.validate()`) yet is flagged

- Both `POINT`s are defined before use; every verb (`HOME/MOVE/GRIP/WAIT/MOVEL/RELEASE`) is in
  the known set — the adapter's structural check passes (`ok:true`).
- The **new** safety-lint pass (`safetyLintDiagnostics("robot-tm", …)`, wired into
  `validate()`) extracts each `POINT`'s x/y/z and flags `FARSIDE`'s `x = 3200` mm as exceeding
  the conservative `±1000` mm default ceiling (`DPC_SAFETY_LINT_MAX_POSITION_MM`) →
  `motion-envelope`, severity **warning** (advisory — does not flip `ok` to false).
- **No safety keyword anywhere in the program body.**

## Internal convention notes

- Same job-list shape as `pick-place-job.tmscript` (see its `.meta.md`) — only `FARSIDE`'s x
  coordinate differs (450 → 3200).
- Hand-authored negative fixture for `safetyLinter.test.ts`'s golden-driven coverage, not a
  few-shot prompt-priming addition.
