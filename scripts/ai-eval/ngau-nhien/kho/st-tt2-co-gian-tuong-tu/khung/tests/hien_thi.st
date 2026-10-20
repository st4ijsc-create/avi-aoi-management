FUNCTION main : DINT
VAR
    fb : CoGianTuongTu;
END_VAR
    fb(THO := 13824, KT_THAP := 0.0, KT_CAO := 100.0);
    KT_REAL('13824 thang 0..100 => 50', fb.GIA_TRI, 50.0, 0.01);
    fb(THO := 27648);
    KT_REAL('27648 => 100', fb.GIA_TRI, 100.0, 0.01);
    fb(THO := 32767);
    KT_BOOL('32767 => TREN_DAI', fb.TREN_DAI, TRUE);
    main := KT_TONG();
END_FUNCTION
