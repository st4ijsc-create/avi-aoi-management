FUNCTION_BLOCK TrungBinhTruot
VAR_INPUT
    MAU : REAL;
    LAY_MAU : BOOL;
    RESET : BOOL;
END_VAR
VAR_OUTPUT
    TB : REAL;
    SO_MAU : INT;
    HOP_LE : BOOL;
END_VAR
VAR
    dem : ARRAY[0..7] OF REAL;
    viTri : INT;
    layCu : BOOL;
    i : INT;
    tong : REAL;
END_VAR
    IF RESET THEN
        FOR i := 0 TO 7 DO
            dem[i] := 0.0;
        END_FOR
        viTri := 0;
        SO_MAU := 0;
    ELSIF LAY_MAU AND NOT layCu THEN
        dem[viTri] := MAU;
        viTri := (viTri + 1) MOD 8;
        IF SO_MAU < 8 THEN
            SO_MAU := SO_MAU + 1;
        END_IF
    END_IF
    layCu := LAY_MAU;
    (* ô chưa dùng luôn = 0 nên cộng cả 8 ô *)
    tong := 0.0;
    FOR i := 0 TO 7 DO
        tong := tong + dem[i];
    END_FOR
    IF SO_MAU > 0 THEN
        TB := tong / INT_TO_REAL(SO_MAU);
    ELSE
        TB := 0.0;
    END_IF
    HOP_LE := SO_MAU = 8;
END_FUNCTION_BLOCK
