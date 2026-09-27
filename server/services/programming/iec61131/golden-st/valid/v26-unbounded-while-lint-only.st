(* Syntactically valid; the SAFETY linter (not the parser) flags the unbounded loop. *)
PROGRAM ConveyorPoll
VAR
    SensorInput : BOOL;
    MotorRun    : BOOL;
END_VAR

WHILE TRUE DO
    MotorRun := SensorInput;
END_WHILE;

END_PROGRAM
