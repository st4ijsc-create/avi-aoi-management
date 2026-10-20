FUNCTION_BLOCK DemSanPham
VAR_INPUT
    CAM_BIEN : BOOL;
    KICH_THUOC_LO : INT;
    RESET : BOOL;
END_VAR
VAR_OUTPUT
    DEM : INT;
    XONG_LO : BOOL;
    SO_LO : INT;
END_VAR
VAR
    suon : R_TRIG;
    ctuDem : CTU;
END_VAR
    suon(CLK := CAM_BIEN);
    ctuDem(CU := suon.Q, R := RESET, PV := KICH_THUOC_LO);
    XONG_LO := FALSE;
    IF RESET THEN
        SO_LO := 0;
    ELSIF ctuDem.Q THEN
        XONG_LO := TRUE;
        SO_LO := SO_LO + 1;
        ctuDem(CU := FALSE, R := TRUE);   (* về 0 ngay trong chu kỳ đủ lô *)
    END_IF
    DEM := ctuDem.CV;
END_FUNCTION_BLOCK
