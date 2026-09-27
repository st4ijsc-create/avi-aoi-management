PROGRAM StandardConversions
VAR
    Stamp   : DATE_AND_TIME := DT#2024-01-31-08:15:00;
    Clock   : TIME_OF_DAY;
    Count   : DINT := 42;
    Ratio   : REAL;
    Raw     : WORD := 16#0042;
    Small   : INT;
    Packed  : WORD;
    Big     : LREAL := 3.9;
    Whole   : DINT;
END_VAR

Clock := DATE_AND_TIME_TO_TIME_OF_DAY(Stamp);
Ratio := DINT_TO_REAL(Count) / 10.0;
Small := WORD_BCD_TO_INT(Raw);
Packed := INT_TO_BCD_WORD(Small);
Whole := LREAL_TRUNC_DINT(Big);
Small := TO_INT(Ratio);
Ratio := LREAL_TO_REAL(Big);

END_PROGRAM
