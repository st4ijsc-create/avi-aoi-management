PROGRAM Conversions
VAR
    Stamp    : DATE_AND_TIME := DT#2024-01-31-08:15:00;
    ClockTod : TIME_OF_DAY;
    OnlyDay  : DATE;
    Raw      : WORD := 16#0123;
    Value    : INT;
    Back     : WORD;
    R        : REAL := 12.7;
    I        : DINT;
    Text     : STRING;
    B        : BOOL;
END_VAR

ClockTod := DATE_AND_TIME_TO_TIME_OF_DAY(Stamp);
OnlyDay := DATE_AND_TIME_TO_DATE(Stamp);
ClockTod := DT_TO_TOD(Stamp);
Value := WORD_BCD_TO_INT(Raw);
Value := BCD_TO_INT(Raw);
Back := INT_TO_BCD(Value);
I := REAL_TO_DINT(R);
I := TRUNC(R);
Text := INT_TO_STRING(Value);
B := INT_TO_BOOL(Value);

END_PROGRAM
