PROGRAM ElseIfWord
VAR
    Level : INT;
    Pump  : BOOL;
    Alarm : BOOL;
END_VAR

IF Level > 90 THEN
    Pump := FALSE;
ELSEIF Level > 95 THEN
    Alarm := TRUE;
END_IF;

END_PROGRAM
