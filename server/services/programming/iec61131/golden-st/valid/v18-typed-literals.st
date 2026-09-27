PROGRAM Literals
VAR
    Mask     : WORD := 16#00FF;
    Bits     : BYTE := 2#1010_0101;
    Oct      : INT := 8#17;
    Small    : INT := INT#5;
    Big      : DINT := 1_000_000;
    Sci      : LREAL := 1.5E-3;
    Neg      : INT := -42;
    Dwell    : TIME := T#1h2m3s;
    Short    : TIME := TIME#500ms;
    Frac     : TIME := T#1.5s;
    Day      : DATE := D#2024-01-31;
    Clock    : TOD := TOD#12:30:00;
    Stamp    : DT := DT#2024-01-31-08:15:00;
    Flag     : BOOL := BOOL#TRUE;
    Masked   : WORD;
END_VAR

Masked := Mask AND 16#0F0F;
IF Dwell > T#1h THEN
    Flag := FALSE;
END_IF;

END_PROGRAM
