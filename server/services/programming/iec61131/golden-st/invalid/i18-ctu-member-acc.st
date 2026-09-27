PROGRAM AllenBradleyStyle
VAR
    Pulse : BOOL;
    Cnt   : CTU;
    Total : INT;
END_VAR

Cnt(CU := Pulse, R := FALSE, PV := 10);
Total := Cnt.ACC;

END_PROGRAM
