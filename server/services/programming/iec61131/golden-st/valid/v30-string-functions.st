PROGRAM StringFunctions
VAR
    S1   : STRING := 'Line-1 ready';
    S2   : STRING;
    N    : INT;
    P    : INT;
END_VAR

N := LEN(S1);
S2 := LEFT(S1, 4);
S2 := RIGHT(S1, 5);
S2 := MID(S1, 2, 6);
S2 := CONCAT(S2, ' / ', S1);
S2 := INSERT(S1, 'X', 3);
S2 := DELETE(S1, 2, 1);
S2 := REPLACE(S1, 'OK', 2, 7);
P := FIND(S1, 'ready');

END_PROGRAM
