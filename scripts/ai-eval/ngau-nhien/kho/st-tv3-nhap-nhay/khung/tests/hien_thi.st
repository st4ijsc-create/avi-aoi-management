FUNCTION main : DINT
VAR
    fb : NhapNhay;
END_VAR
    (* T_SANG = 30ms, T_TOI = 20ms; BAT lên tại t = 10 *)
    fb(BAT := FALSE, T_SANG := T#30ms, T_TOI := T#20ms);
    KT_BOOL('t=0 tat', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=10 bat => sang ngay', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=40 sang du 30ms => toi', fb.DEN, FALSE);
    main := KT_TONG();
END_FUNCTION
