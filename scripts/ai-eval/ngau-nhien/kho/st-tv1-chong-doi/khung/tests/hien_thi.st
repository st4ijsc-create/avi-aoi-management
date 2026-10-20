FUNCTION main : DINT
VAR
    fb : ChongDoi;
    i : INT;
END_VAR
    (* T_BAT = 50ms; t = 0: IN = FALSE *)
    fb(IN := FALSE, T_BAT := T#50ms, T_TAT := T#30ms);
    KT_BOOL('ban dau Q = FALSE', fb.Q, FALSE);
    (* IN = TRUE từ t = 10 (mốc 10): t = 10..50 chưa đủ 50ms *)
    FOR i := 1 TO 5 DO
        KT_BUOC(T#10ms); fb(IN := TRUE);
    END_FOR
    KT_BOOL('t=50 giu 40ms => chua len', fb.Q, FALSE);
    (* t = 60: 60 - 10 = 50 >= 50 *)
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=60 giu 50ms => len', fb.Q, TRUE);
    main := KT_TONG();
END_FUNCTION
