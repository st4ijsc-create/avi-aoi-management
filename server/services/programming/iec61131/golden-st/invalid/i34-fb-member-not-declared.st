FUNCTION_BLOCK FB_Motor
VAR_INPUT
    Run : BOOL;
END_VAR
VAR_OUTPUT
    Running : BOOL;
END_VAR
Running := Run;
END_FUNCTION_BLOCK

PROGRAM UseMotor
VAR
    M1   : FB_Motor;
    Lamp : BOOL;
END_VAR
M1(Run := TRUE);
Lamp := M1.IsRunning;
END_PROGRAM
