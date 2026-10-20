FUNCTION main : DINT
VAR
    fb : BangTaiTuanTu;
END_VAR
    fb(START := TRUE, T_TRE := T#50ms);
    KT_BOOL('start => B3 chay', fb.B3, TRUE);
    KT_BOOL('start => B1 chua chay', fb.B1, FALSE);
    KT_DINT('start => trang thai 1', fb.TRANG_THAI, 1);
    main := KT_TONG();
END_FUNCTION
