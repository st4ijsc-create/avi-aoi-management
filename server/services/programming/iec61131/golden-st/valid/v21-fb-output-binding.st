PROGRAM OutputBinding
VAR
    Go       : BOOL;
    Tmr      : TON;
    Done     : BOOL;
    Elapsed  : TIME;
    Pulse    : TP;
    OffDelay : TOF;
    PulseOut : BOOL;
    Hold     : BOOL;
END_VAR

Tmr(IN := Go, PT := T#2s, Q => Done, ET => Elapsed);
Pulse(IN := Done, PT := T#500ms, Q => PulseOut);
OffDelay(IN := Go, PT := T#5s);
Hold := OffDelay.Q AND NOT Pulse.Q;

END_PROGRAM
