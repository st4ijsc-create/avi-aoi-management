FUNCTION DongGoiBit : WORD
VAR_INPUT
    BIT : ARRAY[0..15] OF BOOL;
END_VAR
VAR
    i : INT;
    w : WORD;
END_VAR
    w := 0;
    FOR i := 0 TO 15 DO
        IF BIT[i] THEN
            w := w OR SHL(WORD#1, i);
        END_IF
    END_FOR
    DongGoiBit := w;
END_FUNCTION

FUNCTION_BLOCK MoGoiBit
VAR_INPUT
    GIA_TRI : WORD;
END_VAR
VAR_OUTPUT
    BIT : ARRAY[0..15] OF BOOL;
    SO_BIT_1 : INT;
END_VAR
VAR
    i : INT;
END_VAR
    SO_BIT_1 := 0;
    FOR i := 0 TO 15 DO
        BIT[i] := (GIA_TRI AND SHL(WORD#1, i)) <> 0;
        IF BIT[i] THEN
            SO_BIT_1 := SO_BIT_1 + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK
