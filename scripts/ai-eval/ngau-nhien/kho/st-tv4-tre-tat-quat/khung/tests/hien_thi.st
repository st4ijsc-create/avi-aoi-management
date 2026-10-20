FUNCTION main : DINT
VAR
    fb : TreTatQuat;
END_VAR
    (* T_CHAY_THEM = 50ms; LENH TRUE t = 0, FALSE từ t = 10 ⇒ tắt tại t = 60 *)
    fb(LENH := TRUE, DUNG_KHAN := FALSE, T_CHAY_THEM := T#50ms);
    KT_BOOL('lenh => quat chay', fb.QUAT, TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_TIME('t=10 vua tha => con 50ms', fb.CON_LAI, T#50ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=60 het 50ms => tat', fb.QUAT, FALSE);
    main := KT_TONG();
END_FUNCTION
