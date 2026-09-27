PROGRAM NoInstance
VAR
    Go   : BOOL;
    Lamp : BOOL;
END_VAR

Timer1(IN := Go, PT := T#1s);
Lamp := Timer1.Q;

END_PROGRAM
