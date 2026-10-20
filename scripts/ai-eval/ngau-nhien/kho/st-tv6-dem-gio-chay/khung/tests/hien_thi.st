FUNCTION main : DINT
VAR
    fb : DemGioChay;
END_VAR
    fb(DANG_CHAY := FALSE, RESET := FALSE);
    KT_BUOC(T#1s); fb(DANG_CHAY := TRUE);
    KT_DINT('chu ky dau chay khong cong', fb.GIAY_TONG, 0);
    KT_BUOC(T#1s); fb(DANG_CHAY := TRUE);
    KT_BUOC(T#1s); fb(DANG_CHAY := TRUE);
    KT_DINT('2 buoc 1s => 2', fb.GIAY_TONG, 2);
    KT_BUOC(T#1s); fb(DANG_CHAY := FALSE);
    KT_DINT('dung => van 2', fb.GIAY_TONG, 2);
    main := KT_TONG();
END_FUNCTION
