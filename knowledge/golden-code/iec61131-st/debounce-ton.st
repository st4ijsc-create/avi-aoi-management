(* SAFETY: AI-assisted golden example. The author reviews, validates and tests it on a
   simulator before any device runs it. Authors PROCESS logic only; never E-stop /
   interlock / SIL safety functions (those stay on the certified controller).
   See knowledge/golden-code/README.md. *)

PROGRAM DebounceInputSignal
VAR
    RawSignal    : BOOL;             (* noisy field input *)
    DebounceTmr  : TON;              (* standard on-delay timer instance *)
    StableSignal : BOOL;             (* debounced, steady result (output) *)
    DebounceTime : TIME := T#20ms;   (* dwell needed to accept a change *)
END_VAR

(* TON keeps Q low until IN has stayed high past PT (DebounceTime);
   this rejects contact chatter on a mechanical input. *)
DebounceTmr(IN := RawSignal, PT := DebounceTime);
StableSignal := DebounceTmr.Q;

END_PROGRAM
