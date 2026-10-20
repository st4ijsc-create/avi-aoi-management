FUNCTION main : DINT
VAR
    fb : TrungBinhTruot;
END_VAR
    fb(MAU := 10.0, LAY_MAU := TRUE);
    fb(LAY_MAU := FALSE);
    fb(MAU := 20.0, LAY_MAU := TRUE);
    fb(LAY_MAU := FALSE);
    KT_REAL('10, 20 => TB 15', fb.TB, 15.0, 0.001);
    KT_DINT('hai mau', fb.SO_MAU, 2);
    KT_BOOL('chua du 8', fb.HOP_LE, FALSE);
    main := KT_TONG();
END_FUNCTION
