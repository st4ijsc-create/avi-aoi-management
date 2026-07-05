// SAFETY: AI-assisted golden example. The author reviews, validates & tests before deploy.
// PROCESS interlocking of readiness flags only, NOT a safety function. E-stop / light-curtain
// / SIL logic stays on the certified safety controller, never in this authoring DSL.
//
// Textual ladder DSL: one rung per line  ->  OUT := <boolean expr>
// Demonstrates multi-rung scan order: Rung 2 & 3 consume Rung 1's computed output.

// Rung 1 - a part is present only when both presence sensors agree.
PartPresent := Sensor1 AND Sensor2

// Rung 2 - the station is ready for a new cycle when a part is present, no cycle is
// currently active, and the upstream buffer is clear (a process permissive, not a guard).
CycleReady := PartPresent AND NOT CycleActive AND UpstreamClear

// Rung 3 - misfeed lamp: exactly one sensor made (a jam) using XOR.
JamLamp := Sensor1 XOR Sensor2
