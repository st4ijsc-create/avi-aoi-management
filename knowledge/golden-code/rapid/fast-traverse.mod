! Hand-authored STRUCTURALLY-UNSAFE example for the linter golden corpus (doc 69 C4;
! advisory-linter demo, not vendor-manual-verified -- ABB RAPID is still Tier B, see
! ../README.md). Certification disclaimer + review process: see fast-traverse.meta.md.
!
! NEGATIVE example: MoveL to pFar uses the predefined ABB speeddata v1500 (1500 mm/s), far
! above a conservative 250 mm/s ceiling. Structurally out-of-range (an excessive commanded
! speed) even though nothing here names any hazard-domain vocabulary at all.
MODULE FastTraverse
    PROC Main()
        MoveJ pHome, v200, z10, tool0;
        MoveL pFar, v1500, fine, tool0;
        MoveL pHome, v200, z10, tool0;
    ENDPROC
ENDMODULE
