FUNCTION KepGioiHan : REAL
VAR_INPUT
    X : REAL;
    LO : REAL;
    HI : REAL;
END_VAR
    IF X < LO THEN
        KepGioiHan := LO;
    ELSIF X > HI THEN
        KepGioiHan := HI;
    ELSE
        KepGioiHan := X;
    END_IF
END_FUNCTION
