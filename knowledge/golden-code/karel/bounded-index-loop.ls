! SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
! vendor-manual-verified RAG example (Fanuc is still Tier B — see ../README.md); reviewed +
! validated on ROBOGUIDE / a real R-30iB controller before any use. Motion/process only.
!
! POSITIVE example: index 3 parts from P[1] to P[2], counting down in R[1]. The back-edge
! jump to LBL[1] is GUARDED by "IF R[1]>0," -- the loop is bounded and always reaches LBL[2].
1:  R[1]=3
2:LBL[1]
3:  L P[1] 200mm/sec CNT50
4:  L P[2] 200mm/sec CNT50
5:  R[1]=R[1]-1
6:  IF R[1]>0,JMP LBL[1]
7:LBL[2]
8:  L P[3] 200mm/sec FINE
