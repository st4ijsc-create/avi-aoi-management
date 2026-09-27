FUNCTION_BLOCK FB_EdgeCounter
VAR_INPUT
    Pulse   : BOOL R_EDGE;
    Release : BOOL F_EDGE;
    Reset   : BOOL;
END_VAR
VAR_OUTPUT
    Rising  : INT;
    Falling : INT;
END_VAR
IF Reset THEN
    Rising := 0;
    Falling := 0;
END_IF;
IF Pulse THEN
    Rising := Rising + 1;
END_IF;
IF Release THEN
    Falling := Falling + 1;
END_IF;
END_FUNCTION_BLOCK

PROGRAM UseEdges
VAR
    Counter : FB_EdgeCounter;
    Sensor  : BOOL;
    Total   : INT;
END_VAR
Counter(Pulse := Sensor, Release := Sensor, Reset := FALSE);
Total := Counter.Rising;
END_PROGRAM
