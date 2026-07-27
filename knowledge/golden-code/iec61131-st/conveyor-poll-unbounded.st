(* Hand-authored STRUCTURALLY-UNSAFE linter golden-corpus example (doc 69 C4; advisory-
   linter demo, not vendor-manual-verified). Certification disclaimer + review process: see
   conveyor-poll-unbounded.meta.md and README.md. *)

(* NEGATIVE example: a condition-driven loop whose condition never turns false and whose
   body has no EXIT/RETURN. Structurally unbounded (an endless scan-cycle loop driving an
   output) even though nothing here names any hazard-domain vocabulary at all — the linter
   flags it on control-flow shape, not wording. *)

PROGRAM ConveyorPoll
VAR
    SensorInput : BOOL;
    MotorRun    : BOOL;
END_VAR

WHILE TRUE DO
    MotorRun := SensorInput;
END_WHILE;

END_PROGRAM
