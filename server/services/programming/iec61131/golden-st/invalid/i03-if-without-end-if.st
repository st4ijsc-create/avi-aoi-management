PROGRAM NoEndIf
VAR
    Level : INT;
    Pump  : BOOL;
END_VAR

IF Level > 80 THEN
    Pump := FALSE;
ELSE
    Pump := TRUE;

END_PROGRAM
