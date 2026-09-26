! SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
! vendor-manual-verified RAG example (ABB RAPID is still Tier B — see ../README.md); reviewed
! + validated in RobotStudio / on a real IRC5 controller before any use. Motion/process only.
!
! POSITIVE example: a bounded FOR loop palletizes 4 parts at moderate, in-envelope speeds
! (v100/v150, well under a conservative 250 mm/s ceiling).
MODULE PalletizeLoop
    PROC Main()
        VAR num i;
        FOR i FROM 1 TO 4 DO
            MoveJ pApproach, v150, z10, tool0;
            MoveL pPick, v100, fine, tool0;
            Close;
            WaitTime 0.3;
            MoveL pApproach, v150, z10, tool0;
            MoveL pPlace, v150, z10, tool0;
            Open;
            WaitTime 0.3;
        ENDFOR
    ENDPROC
ENDMODULE
