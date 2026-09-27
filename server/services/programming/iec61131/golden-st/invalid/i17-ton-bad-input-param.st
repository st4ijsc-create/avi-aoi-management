PROGRAM BadTimerParam
VAR
    Go   : BOOL;
    Tmr  : TON;
    Lamp : BOOL;
END_VAR

Tmr(IN := Go, PRESET := T#2s);
Lamp := Tmr.Q;

END_PROGRAM
