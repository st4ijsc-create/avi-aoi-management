PROGRAM TimeArithmetic
VAR
    Dwell     : TIME := T#2s;
    Extra     : TIME := T#500ms;
    Total     : TIME;
    Diff      : TIME;
    Scaled    : TIME;
    Half      : TIME;
    ShiftTod  : TOD := TOD#06:00:00;
    NowTod    : TOD := TOD#14:30:00;
    LaterTod  : TOD;
    EarlyTod  : TOD;
    Stamp     : DT := DT#2024-01-31-08:15:00;
    Stamp2    : DT;
    Stamp3    : DT;
    Day1      : DATE := D#2024-01-01;
    Day2      : DATE := D#2024-02-01;
    DaySpan   : TIME;
    TodSpan   : TIME;
    DtSpan    : TIME;
    Joined    : DT;
END_VAR

Total := ADD_TIME(Dwell, Extra);
Diff := SUB_TIME(Dwell, Extra);
Scaled := MULTIME(Dwell, 3);
Half := DIVTIME(Dwell, 2);
LaterTod := ADD_TOD_TIME(ShiftTod, T#8h);
EarlyTod := SUB_TOD_TIME(NowTod, T#30m);
TodSpan := SUB_TOD_TOD(NowTod, ShiftTod);
Stamp2 := ADD_DT_TIME(Stamp, T#1h);
Stamp3 := SUB_DT_TIME(Stamp, T#15m);
DtSpan := SUB_DT_DT(Stamp2, Stamp);
DaySpan := SUB_DATE_DATE(Day2, Day1);
Joined := CONCAT_DATE_TOD(Day1, ShiftTod);

END_PROGRAM
