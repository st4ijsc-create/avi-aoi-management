PROGRAM UndeclaredOutput
VAR
    Go  : BOOL;
    Tmr : TON;
END_VAR

Tmr(IN := Go, PT := T#1s, Q => DoneFlag);

END_PROGRAM
