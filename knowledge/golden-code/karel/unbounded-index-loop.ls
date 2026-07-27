! Hand-authored STRUCTURALLY-UNSAFE example for the linter golden corpus (doc 69 C4;
! advisory-linter demo, not vendor-manual-verified -- Fanuc is still Tier B, see
! ../README.md). Certification disclaimer + review process: see unbounded-index-loop.meta.md.
!
! NEGATIVE example: the same index pattern as bounded-index-loop.ls, but line 6 lost its
! "IF R[1]>0," conditional -- JMP LBL[1] is now UNCONDITIONAL, so the register decrement is
! never checked and the motion loop never reaches LBL[2]. Structurally unbounded (an endless
! motion loop) even though nothing here names any hazard-domain vocabulary at all.
1:  R[1]=3
2:LBL[1]
3:  L P[1] 200mm/sec CNT50
4:  L P[2] 200mm/sec CNT50
5:  R[1]=R[1]-1
6:  JMP LBL[1]
7:LBL[2]
8:  L P[3] 200mm/sec FINE
