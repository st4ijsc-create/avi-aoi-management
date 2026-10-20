FUNCTION_BLOCK BoPI
VAR_INPUT
    SP : REAL;
    PV : REAL;
    KP : REAL;
    TI : REAL;
    TS : TIME;
    U_MIN : REAL;
    U_MAX : REAL;
    MAN : BOOL;
    U_TAY : REAL;
END_VAR
VAR_OUTPUT
    U : REAL;
    I_TP : REAL;
    BAO_HOA_CAO : BOOL;
    BAO_HOA_THAP : BOOL;
END_VAR
VAR
    tTruoc : TIME;
    daTinh : BOOL;
    e : REAL;
    uTho : REAL;
    tsGiay : REAL;
END_VAR
    e := SP - PV;
    IF MAN THEN
        (* Tay: U theo U_TAY, tích phân bám để chuyển về tự động không giật *)
        U := KepGioiHan(X := U_TAY, LO := U_MIN, HI := U_MAX);
        I_TP := U - KP * e;
        BAO_HOA_CAO := FALSE;
        BAO_HOA_THAP := FALSE;
        tTruoc := G_NOW;
        daTinh := TRUE;
    ELSIF NOT daTinh OR (G_NOW - tTruoc >= TS) THEN
        tTruoc := G_NOW;
        daTinh := TRUE;
        tsGiay := LINT_TO_REAL(TIME_TO_LINT(TS)) / 1.0E9;
        uTho := KP * e + I_TP;
        BAO_HOA_CAO := uTho > U_MAX;
        BAO_HOA_THAP := uTho < U_MIN;
        (* Chống bão hoà: không tích phân thêm theo chiều đang bão hoà *)
        IF NOT ((BAO_HOA_CAO AND e > 0.0) OR (BAO_HOA_THAP AND e < 0.0)) THEN
            I_TP := I_TP + KP * tsGiay / TI * e;
        END_IF
        U := KepGioiHan(X := uTho, LO := U_MIN, HI := U_MAX);
    END_IF
END_FUNCTION_BLOCK
