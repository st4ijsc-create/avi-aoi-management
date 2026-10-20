FUNCTION BcdSangInt : INT
VAR_INPUT
    BCD : WORD;
END_VAR
VAR_OUTPUT
    LOI : BOOL;
END_VAR
VAR
    k : INT;
    nib : INT;
    v : INT;
END_VAR
    LOI := FALSE;
    v := 0;
    FOR k := 3 TO 0 BY -1 DO
        nib := WORD_TO_INT(SHR(BCD, k * 4) AND 16#000F);
        IF nib > 9 THEN
            LOI := TRUE;
        END_IF
        v := v * 10 + nib;
    END_FOR
    IF LOI THEN
        v := 0;
    END_IF
    BcdSangInt := v;
END_FUNCTION

FUNCTION IntSangBcd : WORD
VAR_INPUT
    GIA_TRI : INT;
END_VAR
VAR_OUTPUT
    LOI : BOOL;
END_VAR
VAR
    k : INT;
    x : INT;
    w : WORD;
END_VAR
    w := 0;
    IF (GIA_TRI < 0) OR (GIA_TRI > 9999) THEN
        LOI := TRUE;
    ELSE
        LOI := FALSE;
        x := GIA_TRI;
        FOR k := 0 TO 3 DO
            w := w OR SHL(INT_TO_WORD(x MOD 10), k * 4);
            x := x / 10;
        END_FOR
    END_IF
    IntSangBcd := w;
END_FUNCTION
