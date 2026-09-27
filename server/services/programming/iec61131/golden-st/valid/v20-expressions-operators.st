PROGRAM Expressions
VAR
    A, B, C : BOOL;
    X, Y    : INT;
    R       : REAL;
    Res     : BOOL;
    Parity  : INT;
END_VAR

Res := (A AND B) OR (NOT C XOR A) & (X <> Y);
Res := (X >= 10) AND (Y <= -3) OR (X = Y) AND NOT (X > Y OR X < Y);
Parity := X MOD 2;
R := INT_TO_REAL(X) ** 2.0 + INT_TO_REAL(Y) / 3.0 - 1.0;
X := -(Y * 4) + ABS(Y) - MAX(X, Y) + MIN(X, 0) + LIMIT(0, Y, 100);
Res := SEL(A, B, C);

END_PROGRAM
