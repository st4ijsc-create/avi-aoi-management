FUNCTION main : DINT
VAR
    fb : CanhBaoXacNhan;
END_VAR
    (* T_TRE = 30ms; điều kiện từ t = 10 ⇒ cảnh báo tại t = 40 *)
    fb(DIEU_KIEN := FALSE, XAC_NHAN := FALSE, T_TRE := T#30ms);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=40 => 1', fb.TRANG_THAI, 1);
    KT_BOOL('t=40 nhap nhay', fb.NHAP_NHAY, TRUE);
    KT_BUOC(T#10ms); fb(XAC_NHAN := TRUE);
    KT_DINT('xac nhan => 2', fb.TRANG_THAI, 2);
    main := KT_TONG();
END_FUNCTION
