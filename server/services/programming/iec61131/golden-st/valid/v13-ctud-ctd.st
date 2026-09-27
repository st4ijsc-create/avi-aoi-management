PROGRAM BufferLevel
VAR
    InSensor  : BOOL;
    OutSensor : BOOL;
    Clear     : BOOL;
    Load      : BOOL;
    Level     : CTUD;
    Remaining : CTD;
    Full      : BOOL;
    Empty     : BOOL;
    Parts     : INT;
END_VAR

Level(CU := InSensor, CD := OutSensor, R := Clear, LD := FALSE, PV := 20);
Full := Level.QU;
Empty := Level.QD;
Parts := Level.CV;
Remaining(CD := OutSensor, LD := Load, PV := 100);
IF Remaining.Q THEN
    Load := TRUE;
END_IF;

END_PROGRAM
