FUNCTION_BLOCK TreTru
VAR_INPUT
    PV : REAL;
    SP : REAL;
    DAI : REAL;
    CHE_DO_LAM_LANH : BOOL;
END_VAR
VAR_OUTPUT
    Q : BOOL;
END_VAR
VAR
    d : REAL;
    thap : REAL;
    cao : REAL;
END_VAR
    d := DAI;
    IF d < 0.0 THEN d := 0.0; END_IF
    thap := SP - d / 2.0;
    cao := SP + d / 2.0;
    IF NOT CHE_DO_LAM_LANH THEN
        (* sưởi: điều kiện TẮT xét trước *)
        IF PV >= cao THEN
            Q := FALSE;
        ELSIF PV <= thap THEN
            Q := TRUE;
        END_IF
    ELSE
        (* làm lạnh: điều kiện TẮT xét trước *)
        IF PV <= thap THEN
            Q := FALSE;
        ELSIF PV >= cao THEN
            Q := TRUE;
        END_IF
    END_IF
END_FUNCTION_BLOCK
