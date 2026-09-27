PROGRAM Latches
VAR
    SetBtn    : BOOL;
    ResetBtn  : BOOL;
    Released  : F_TRIG;
    PumpLatch : SR;
    FanLatch  : RS;
    Pump      : BOOL;
    Fan       : BOOL;
END_VAR

Released(CLK := SetBtn);
PumpLatch(S1 := SetBtn, R := ResetBtn);
FanLatch(S := Released.Q, R1 := ResetBtn);
Pump := PumpLatch.Q1;
Fan := FanLatch.Q1;

END_PROGRAM
