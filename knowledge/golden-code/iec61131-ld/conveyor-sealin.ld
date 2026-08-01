// SAFETY: AI-assisted golden example. The author reviews, validates & tests before deploy.
// This is PROCESS control (a motor seal-in), NOT a safety function. The real E-stop and any
// safety interlock stay HARDWIRED to a safety relay / certified PLC, never in this DSL.
//
// Textual ladder DSL: one rung per line  ->  OUT := <boolean expr>
// Grammar (boolEval): identifiers, AND OR NOT XOR, parentheses, TRUE / FALSE.
// No numbers, no comparisons — pure boolean.

// Rung 1 - seal-in latch: ConveyorRun holds itself once StartPB is pressed and
// drops when the process StopPB (a normal cycle-stop, NOT an E-stop) opens.
ConveyorRun := (StartPB OR ConveyorRun) AND NOT StopPB AND ReadyToRun

// Rung 2 - the running lamp follows the run bit (scan-forward uses Rung 1's output).
RunLamp := ConveyorRun
