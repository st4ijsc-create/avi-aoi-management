VAR_GLOBAL
    gMachineReady : BOOL;
    gCycleCount   : DINT;
END_VAR

PROGRAM Cycle
VAR_EXTERNAL
    gMachineReady : BOOL;
    gCycleCount   : DINT;
END_VAR
VAR RETAIN
    TotalCycles : DINT;
END_VAR
VAR CONSTANT
    MAX_CYCLES : DINT := 1000000;
END_VAR
VAR
    CycleStart : BOOL;
    Edge       : R_TRIG;
END_VAR

Edge(CLK := CycleStart AND gMachineReady);
IF Edge.Q AND (TotalCycles < MAX_CYCLES) THEN
    TotalCycles := TotalCycles + 1;
    gCycleCount := TotalCycles;
END_IF;

END_PROGRAM
