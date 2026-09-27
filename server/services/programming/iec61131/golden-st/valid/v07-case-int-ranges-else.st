PROGRAM SpeedSelector
VAR
    Mode     : INT;
    SpeedSet : REAL;
    Fault    : BOOL;
END_VAR

CASE Mode OF
    0:
        SpeedSet := 0.0;
    1, 2:
        SpeedSet := 25.0;
    3..5:
        SpeedSet := 50.0 + INT_TO_REAL(Mode) * 5.0;
ELSE
    SpeedSet := 0.0;
    Fault := TRUE;
END_CASE

END_PROGRAM
