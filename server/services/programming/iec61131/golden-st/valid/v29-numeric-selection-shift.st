PROGRAM NumericSelectShift
VAR
    X, Y, Z  : REAL;
    A, B     : INT;
    W        : WORD := 16#00F0;
    G        : BOOL;
    K        : INT := 1;
    Cmp      : BOOL;
END_VAR

X := ABS(Y) + SQRT(Z) + LN(Z) + LOG(Z) + EXP(Y);
X := SIN(Y) + COS(Y) + TAN(Y) + ASIN(Z) + ACOS(Z) + ATAN(Z);
X := EXPT(Y, 2.0);
A := ADD(A, B, 3);
A := SUB(A, B);
A := MUL(A, B);
A := DIV(A, 2);
A := MOVE(B);
A := SEL(G, A, B);
A := MAX(A, B, 7);
A := MIN(A, B);
A := LIMIT(0, A, 100);
A := MUX(K, 10, 20, 30);
W := SHL(W, 2);
W := SHR(W, 1);
W := ROL(W, 4);
W := ROR(W, 4);
Cmp := GT(A, B) OR GE(A, B) OR EQ(A, B) OR LE(A, B) OR LT(A, B) OR NE(A, B);

END_PROGRAM
