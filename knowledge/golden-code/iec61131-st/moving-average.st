(* SAFETY: AI-assisted golden example. The author reviews, validates and tests it on a
   simulator before any device runs it. Authors PROCESS logic only; never E-stop /
   interlock / SIL safety functions (those stay on the certified controller).
   See knowledge/golden-code/README.md. *)

PROGRAM MovingAverage
VAR
    Samples    : ARRAY[0..7] OF REAL;   (* ring buffer, window N = 8 *)
    WriteIndex : INT := 0;              (* next slot to overwrite *)
    Idx        : INT;                   (* cursor over the window *)
    Sum        : REAL := 0.0;
    NewSample  : REAL;                  (* latest raw reading (input) *)
    Average    : REAL;                  (* smoothed result (output) *)
END_VAR

(* push the newest reading into the ring buffer, then advance the cursor *)
Samples[WriteIndex] := NewSample;
WriteIndex := WriteIndex + 1;
IF WriteIndex >= 8 THEN
    WriteIndex := 0;
END_IF;

(* accumulate the whole window, then divide by N *)
Sum := 0.0;
FOR Idx := 0 TO 7 DO
    Sum := Sum + Samples[Idx];
END_FOR;
Average := Sum / 8.0;

END_PROGRAM
