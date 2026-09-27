PROGRAM MovingAverage
VAR
    Samples    : ARRAY[0..7] OF REAL;
    WriteIndex : INT := 0;
    Idx        : INT;
    Sum        : REAL := 0.0;
    NewSample  : REAL;
    Average    : REAL;
END_VAR

Samples[WriteIndex] := NewSample;
WriteIndex := WriteIndex + 1;
IF WriteIndex >= 8 THEN
    WriteIndex := 0;
END_IF;

Sum := 0.0;
FOR Idx := 0 TO 7 DO
    Sum := Sum + Samples[Idx];
END_FOR;
Average := Sum / 8.0;

END_PROGRAM
