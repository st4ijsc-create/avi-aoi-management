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
