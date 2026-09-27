PROGRAM BatchCounter
VAR
    PartSensor : BOOL;
    ResetPB    : BOOL;
    Edge       : R_TRIG;
    Counter    : CTU;
    BatchDone  : BOOL;
    Count      : INT;
END_VAR

Edge(CLK := PartSensor);
Counter(CU := Edge.Q, R := ResetPB, PV := 50);
BatchDone := Counter.Q;
Count := Counter.CV;

END_PROGRAM
