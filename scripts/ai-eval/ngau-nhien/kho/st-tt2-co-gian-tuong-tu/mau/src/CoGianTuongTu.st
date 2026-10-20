FUNCTION_BLOCK CoGianTuongTu
VAR_INPUT
    THO : INT;
    KT_THAP : REAL;
    KT_CAO : REAL;
END_VAR
VAR_OUTPUT
    GIA_TRI : REAL;
    DUOI_DAI : BOOL;
    TREN_DAI : BOOL;
    LOI : BOOL;
END_VAR
VAR
    v : REAL;
    lo : REAL;
    hi : REAL;
END_VAR
    DUOI_DAI := THO < -1382;
    TREN_DAI := THO > 32511;
    LOI := DUOI_DAI OR TREN_DAI;
    IF NOT LOI THEN
        v := KT_THAP + INT_TO_REAL(THO) / 27648.0 * (KT_CAO - KT_THAP);
        lo := MIN(KT_THAP, KT_CAO);
        hi := MAX(KT_THAP, KT_CAO);
        GIA_TRI := LIMIT(lo, v, hi);
    END_IF
END_FUNCTION_BLOCK
