PROGRAM NoEndCase
VAR
    Step  : INT;
    Valve : BOOL;
END_VAR

CASE Step OF
    0: Valve := FALSE;
    1: Valve := TRUE;

END_PROGRAM
