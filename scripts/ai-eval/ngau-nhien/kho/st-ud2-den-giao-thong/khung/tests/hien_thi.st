FUNCTION main : DINT
VAR
    fb : DenGiaoThong;
END_VAR
    fb(T_XANH_MIN := T#100ms, T_VANG := T#30ms, T_NGUOI := T#50ms, T_DO_CHUNG := T#20ms, T_NHAY := T#20ms);
    KT_BOOL('dau tien xanh xe', fb.XE_XANH, TRUE);
    KT_BOOL('dau tien do nguoi', fb.NG_DO, TRUE);
    KT_DINT('dau tien trang thai 0', fb.TRANG_THAI, 0);
    KT_BUOC(T#10ms);
    fb(NHAP_NHAY_VANG := TRUE);
    KT_DINT('nhap nhay => 4', fb.TRANG_THAI, 4);
    main := KT_TONG();
END_FUNCTION
