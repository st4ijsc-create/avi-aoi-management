PROGRAM EdgeInLocalVar
VAR
    Sensor : BOOL R_EDGE;
    Count  : INT;
END_VAR

IF Sensor THEN
    Count := Count + 1;
END_IF;

END_PROGRAM
