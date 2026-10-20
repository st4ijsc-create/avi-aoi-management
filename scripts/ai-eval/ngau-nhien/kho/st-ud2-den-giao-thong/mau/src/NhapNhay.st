FUNCTION_BLOCK NhapNhay
VAR_INPUT
    EN : BOOL;
    T_NUA : TIME;
END_VAR
VAR_OUTPUT
    Q : BOOL;
END_VAR
VAR
    tDao : TON;
    dangBat : BOOL;
END_VAR
    IF NOT EN THEN
        Q := FALSE;
        dangBat := FALSE;
        tDao(IN := FALSE);
    ELSE
        IF NOT dangBat THEN
            dangBat := TRUE;
            Q := TRUE;
            tDao(IN := FALSE);
        END_IF
        tDao(IN := TRUE, PT := T_NUA);
        IF tDao.Q THEN
            Q := NOT Q;
            tDao(IN := FALSE);
            tDao(IN := TRUE, PT := T_NUA);
        END_IF
    END_IF
END_FUNCTION_BLOCK
