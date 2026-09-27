PROGRAM Nested
VAR
    Data  : ARRAY[1..20] OF INT;
    I     : INT;
    Pos   : INT;
    Neg   : INT;
    Zero  : INT;
END_VAR

Pos := 0; Neg := 0; Zero := 0;
FOR I := 20 TO 1 BY -1 DO
    IF Data[I] > 0 THEN
        Pos := Pos + 1;
    ELSIF Data[I] < 0 THEN
        Neg := Neg + 1;
        IF Neg > 5 THEN
            EXIT;
        END_IF;
    ELSE
        Zero := Zero + 1;
    END_IF;
END_FOR;

END_PROGRAM
