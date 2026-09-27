FUNCTION_BLOCK FB_TrafficLight
VAR_INPUT
    Enable : BOOL;
END_VAR
VAR_OUTPUT
    Red    : BOOL;
    Yellow : BOOL;
    Green  : BOOL;
END_VAR
VAR
    Phase  : INT := 0;
    Timers : ARRAY[0..2] OF TON;
    Times  : ARRAY[0..2] OF TIME := [T#10s, T#3s, T#8s];
END_VAR

IF NOT Enable THEN
    Phase := 0;
    Red := TRUE; Yellow := FALSE; Green := FALSE;
    RETURN;
END_IF;

Timers[Phase](IN := TRUE, PT := Times[Phase]);
IF Timers[Phase].Q THEN
    Timers[Phase](IN := FALSE);
    Phase := (Phase + 1) MOD 3;
END_IF;

Red := Phase = 0;
Green := Phase = 1;
Yellow := Phase = 2;

END_FUNCTION_BLOCK

PROGRAM Crossing
VAR
    Light : FB_TrafficLight;
    Run   : BOOL := TRUE;
    Stop  : BOOL;
END_VAR
Light(Enable := Run);
Stop := Light.Red;
END_PROGRAM
