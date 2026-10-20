FUNCTION_BLOCK TonKho
VAR_INPUT
    LAY_RA : BOOL;
    NAP : BOOL;
    SO_NAP : INT;
    NGUONG_THAP : INT;
END_VAR
VAR_OUTPUT
    TON : INT;
    SAP_HET : BOOL;
    HET : BOOL;
END_VAR
VAR
    suon : R_TRIG;
    ctdTon : CTD;
END_VAR
    suon(CLK := LAY_RA);
    (* chặn đếm xuống dưới 0: CTD chuẩn không tự chặn *)
    ctdTon(CD := suon.Q AND ctdTon.CV > 0, LD := NAP, PV := SO_NAP);
    TON := ctdTon.CV;
    SAP_HET := TON <= NGUONG_THAP;
    HET := TON = 0;
END_FUNCTION_BLOCK
