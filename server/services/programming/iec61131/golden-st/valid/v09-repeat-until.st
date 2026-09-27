PROGRAM ShiftRegister
VAR
    Reg   : ARRAY[0..4] OF INT;
    K     : INT;
    Input : INT;
END_VAR

K := 4;
REPEAT
    Reg[K] := Reg[K - 1];
    K := K - 1;
UNTIL K = 0
END_REPEAT;
Reg[0] := Input;

END_PROGRAM
