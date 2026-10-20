FUNCTION_BLOCK ChongDoi
VAR_INPUT
    IN : BOOL;
    T_BAT : TIME;
    T_TAT : TIME;
END_VAR
VAR_OUTPUT
    Q : BOOL;
END_VAR
VAR
    tonBat : TON;
    tonTat : TON;
END_VAR
    tonBat(IN := IN, PT := T_BAT);
    tonTat(IN := NOT IN, PT := T_TAT);
    IF tonBat.Q THEN
        Q := TRUE;
    ELSIF tonTat.Q THEN
        Q := FALSE;
    END_IF
END_FUNCTION_BLOCK
