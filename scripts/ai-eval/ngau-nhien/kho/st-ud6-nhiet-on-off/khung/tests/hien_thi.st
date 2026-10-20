FUNCTION main : DINT
VAR
    fb : DieuKhienNhietLo;
END_VAR
    fb(BAT := TRUE, NHIET := 20.0, SP := 100.0, TRE := 5.0, NGUONG_CAO := 110.0, NGUONG_HH := 120.0);
    KT_BOOL('lanh => suoi', fb.SUOI, TRUE);
    KT_DINT('lanh => dieu khien', fb.TRANG_THAI, 1);
    fb(NHIET := 130.0);
    KT_BOOL('130 => ngat HH', fb.NGAT_HH, TRUE);
    KT_BOOL('130 => suoi tat', fb.SUOI, FALSE);
    main := KT_TONG();
END_FUNCTION
