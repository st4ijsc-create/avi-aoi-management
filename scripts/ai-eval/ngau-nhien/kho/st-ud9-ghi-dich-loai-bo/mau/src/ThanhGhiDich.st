FUNCTION_BLOCK ThanhGhiDich
VAR_INPUT
    DICH : BOOL;
    GHI : BOOL;
    XOA : BOOL;
    VI_TRI : INT;
END_VAR
VAR_OUTPUT
    Q : BOOL;
    SO_O : INT;
END_VAR
VAR
    o : ARRAY[0..32] OF BOOL;
    i : INT;
END_VAR
    IF XOA THEN
        FOR i := 0 TO 32 DO o[i] := FALSE; END_FOR
    ELSE
        IF DICH THEN
            FOR i := 32 TO 1 BY -1 DO o[i] := o[i - 1]; END_FOR
            o[0] := FALSE;
        END_IF
        IF GHI THEN
            o[0] := TRUE;
        END_IF
    END_IF
    IF VI_TRI >= 0 AND VI_TRI <= 32 THEN
        Q := o[VI_TRI];
    ELSE
        Q := FALSE;
    END_IF
    SO_O := 0;
    FOR i := 0 TO 32 DO
        IF o[i] THEN SO_O := SO_O + 1; END_IF
    END_FOR
END_FUNCTION_BLOCK
