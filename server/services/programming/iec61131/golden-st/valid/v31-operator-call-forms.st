PROGRAM OperatorCallForms
VAR
    A, B, C : BOOL;
    W1, W2  : WORD;
    N       : INT := 17;
    R       : INT;
END_VAR

R := MOD(N, 5);
C := AND(A, B);
C := OR(A, B, C);
C := XOR(A, B);
C := NOT(A);
W1 := AND(W1, W2);
C := A AND (B OR NOT C);

END_PROGRAM
