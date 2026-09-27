FUNCTION Scale : REAL
VAR_INPUT
    Raw    : INT;
    RawMax : INT;
    EngMax : REAL;
END_VAR
    IF RawMax <= 0 THEN
        Scale := 0.0;
        RETURN;
    END_IF;
    Scale := INT_TO_REAL(Raw) / INT_TO_REAL(RawMax) * EngMax;
END_FUNCTION

PROGRAM Main
VAR
    AnalogIn : INT;
    Pressure : REAL;
END_VAR
    Pressure := Scale(Raw := AnalogIn, RawMax := 27648, EngMax := 10.0);
    Pressure := Scale(AnalogIn, 27648, 16.0);
END_PROGRAM
