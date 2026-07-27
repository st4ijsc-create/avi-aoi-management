! SAFETY: hand-authored example for the safety-linter golden corpus (doc 69 C4). Not a
! vendor-manual-verified RAG example (ABB RAPID is still Tier B — see ../README.md); reviewed
! + validated in RobotStudio / on a real IRC5 controller before any use. Motion/process only.
!
! NEGATIVE example: MoveL to pFar uses the predefined ABB speeddata v1500 (1500 mm/s), far
! above a conservative 250 mm/s ceiling. Structurally unsafe (an excessive commanded speed)
! even though nothing here names any safety concept at all.
MODULE FastTraverse
    PROC Main()
        MoveJ pHome, v200, z10, tool0;
        MoveL pFar, v1500, fine, tool0;
        MoveL pHome, v200, z10, tool0;
    ENDPROC
ENDMODULE
