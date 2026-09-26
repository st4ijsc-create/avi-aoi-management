' Hand-authored STRUCTURALLY-UNSAFE example for the linter golden corpus (doc 69 C4;
' advisory-linter demo, not vendor-manual-verified -- MELFA-BASIC is still Tier B, see
' ../README.md). Distinct from ../mitsubishi-engineering/ (MELSEC PLC device/recipe tables).
' Certification disclaimer + review process: see bare-pick-place.meta.md.
'
' NEGATIVE example: the same pick-place sequence as gated-pick-place.prg, but with no
' conditional anywhere in the file -- MOV/MVS/M_OUT run unconditionally every scan.
' Structurally ungated (motion + output with no upstream conditional) even though nothing
' here names any hazard-domain vocabulary at all.
10 SPD 150
20 MOV P1
30 MVS P2
40 M_OUT(10) = 1
50 DLY 0.3
60 M_OUT(10) = 0
70 MOV P0
80 END
