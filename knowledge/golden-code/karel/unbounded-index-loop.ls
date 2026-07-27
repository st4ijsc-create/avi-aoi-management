! SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
! vendor-manual-verified RAG example (Fanuc is still Tier B — see ../README.md); reviewed +
! validated on ROBOGUIDE / a real R-30iB controller before any use. Motion/process only.
!
! NEGATIVE example: the same index pattern as bounded-index-loop.ls, but line 6 lost its
! "IF R[1]>0," guard -- JMP LBL[1] is now UNCONDITIONAL, so the register decrement is never
! checked and the motion loop never reaches LBL[2]. Structurally unsafe (infinite motion
! loop) even though nothing here names any safety concept at all.
1:  R[1]=3
2:LBL[1]
3:  L P[1] 200mm/sec CNT50
4:  L P[2] 200mm/sec CNT50
5:  R[1]=R[1]-1
6:  JMP LBL[1]
7:LBL[2]
8:  L P[3] 200mm/sec FINE
