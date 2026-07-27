' SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
' vendor-manual-verified RAG example (MELFA-BASIC is still Tier B — see ../README.md);
' reviewed + validated in RT ToolBox / on a real controller before any use. Motion/process
' logic only -- distinct from ../mitsubishi-engineering/ (MELSEC PLC device/recipe tables).
'
' NEGATIVE example: the same pick-place sequence as gated-pick-place.prg, but with no
' conditional anywhere in the file -- MOV/MVS/M_OUT run unconditionally every scan.
' Structurally unsafe (unguarded motion + output) even though nothing here names any safety
' concept at all.
10 SPD 150
20 MOV P1
30 MVS P2
40 M_OUT(10) = 1
50 DLY 0.3
60 M_OUT(10) = 0
70 MOV P0
80 END
