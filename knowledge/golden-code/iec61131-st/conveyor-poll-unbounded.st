(* SAFETY: AI-assisted golden example. The author reviews, validates and tests it on a
   simulator before device runs it. Authors PROCESS logic only; never E-stop / interlock /
   SIL safety functions (those stay on the certified controller).
   See knowledge/golden-code/README.md. *)

(* NEGATIVE example added to the safety-linter golden corpus (doc 69 C4): a condition-driven
   loop whose condition never turns false and whose body has no EXIT/RETURN. Structurally
   unsafe (an unbounded scan-cycle loop driving an output) even though nothing here names any
   safety concept at all — the safety-linter flags it on structure, not vocabulary. *)

PROGRAM ConveyorPoll
VAR
    SensorInput : BOOL;
    MotorRun    : BOOL;
END_VAR

WHILE TRUE DO
    MotorRun := SensorInput;
END_WHILE;

END_PROGRAM
