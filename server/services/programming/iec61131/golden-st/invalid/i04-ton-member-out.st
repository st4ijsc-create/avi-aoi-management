PROGRAM WrongTimerMember
VAR
    Go   : BOOL;
    Tmr  : TON;
    Lamp : BOOL;
END_VAR

Tmr(IN := Go, PT := T#2s);
Lamp := Tmr.OUT;

END_PROGRAM
