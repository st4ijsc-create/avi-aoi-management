(* Conveyor: Start push-button latches the motor, NC Stop drops it,
   a TON delays the running lamp by 2 s. *)
PROGRAM ConveyorStartStop
VAR_INPUT
    StartPB   : BOOL;          (* NO push-button *)
    StopPB_NC : BOOL := TRUE;  (* NC push-button: FALSE when pressed *)
END_VAR
VAR_OUTPUT
    Motor      : BOOL;
    RunningLmp : BOOL;
END_VAR
VAR
    RunDelay : TON;
END_VAR

Motor := (StartPB OR Motor) AND StopPB_NC;
RunDelay(IN := Motor, PT := T#2s);
RunningLmp := RunDelay.Q;

END_PROGRAM
