FUNCTION main : DINT
VAR
    fb : GiamSatPhanHoi;
END_VAR
    fb(LENH_CHAY := TRUE, PHAN_HOI := FALSE, T_CHO := T#40ms, RESET := FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BOOL('dang chay co phan hoi => khong loi', fb.BAO_DONG, FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE);
    KT_BOOL('mat phan hoi => loi', fb.LOI_MAT_PHAN_HOI, TRUE);
    KT_BOOL('mat phan hoi => bao dong', fb.BAO_DONG, TRUE);
    main := KT_TONG();
END_FUNCTION
