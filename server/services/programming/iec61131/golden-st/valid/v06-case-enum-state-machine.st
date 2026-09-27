TYPE
    E_FillState : (Idle, Filling, Settling, Done);
END_TYPE

PROGRAM FillStation
VAR
    State      : E_FillState := Idle;
    StartReq   : BOOL;
    LevelHigh  : BOOL;
    Valve      : BOOL;
    SettleTmr  : TON;
END_VAR

CASE State OF
    Idle:
        Valve := FALSE;
        IF StartReq THEN
            State := Filling;
        END_IF;
    Filling:
        Valve := TRUE;
        IF LevelHigh THEN
            State := E_FillState#Settling;
        END_IF;
    Settling:
        Valve := FALSE;
        SettleTmr(IN := TRUE, PT := T#3s);
        IF SettleTmr.Q THEN
            SettleTmr(IN := FALSE);
            State := Done;
        END_IF;
    Done:
        IF NOT StartReq THEN
            State := Idle;
        END_IF;
END_CASE;

END_PROGRAM
