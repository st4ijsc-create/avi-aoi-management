' SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
' vendor-manual-verified RAG example (MELFA-BASIC is still Tier B — see ../README.md);
' reviewed + validated in RT ToolBox / on a real controller before any use. Motion/process
' logic only -- distinct from ../mitsubishi-engineering/ (MELSEC PLC device/recipe tables).
'
' POSITIVE example: the pick-place block only runs when M_IN(1) is set (a part-present /
' station-ready digital input), so the motion + output block is guarded.
10 SPD 150
20 IF M_IN(1) = 1 THEN
30   MOV P1
40   MVS P2
50   M_OUT(10) = 1
60   DLY 0.3
70   M_OUT(10) = 0
80   MOV P0
90 ENDIF
100 END
