FUNCTION main : DINT
VAR
    fb : CanhBaoXacNhan;
END_VAR
    (* T_TRE = 30ms, bước 10ms *)
    fb(DIEU_KIEN := FALSE, XAC_NHAN := FALSE, T_TRE := T#30ms);
    KT_DINT('t=0 => 0', fb.TRANG_THAI, 0);
    KT_BOOL('t=0 khong nhap nhay', fb.NHAP_NHAY, FALSE);
    KT_BOOL('t=0 khong canh bao', fb.CO_CANH_BAO, FALSE);
    (* điều kiện từ t = 10 (mốc 10) ⇒ thành cảnh báo tại t = 40 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=30 chua du tre => 0', fb.TRANG_THAI, 0);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=40 => 1', fb.TRANG_THAI, 1);
    KT_BOOL('t=40 nhap nhay', fb.NHAP_NHAY, TRUE);
    KT_BOOL('t=40 co canh bao', fb.CO_CANH_BAO, TRUE);
    KT_BUOC(T#10ms); fb(XAC_NHAN := TRUE);
    KT_DINT('t=50 xac nhan => 2', fb.TRANG_THAI, 2);
    KT_BOOL('t=50 het nhap nhay', fb.NHAP_NHAY, FALSE);
    KT_BOOL('t=50 van co canh bao', fb.CO_CANH_BAO, TRUE);
    KT_BUOC(T#10ms); fb(XAC_NHAN := TRUE);
    KT_DINT('t=60 giu xac nhan => 2', fb.TRANG_THAI, 2);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE, XAC_NHAN := FALSE);
    KT_DINT('t=70 2 het dk => 0', fb.TRANG_THAI, 0);
    KT_BOOL('t=70 khong canh bao', fb.CO_CANH_BAO, FALSE);
    (* điều kiện ngắn 30ms (t = 80..100) < trễ: không thành cảnh báo *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE);
    KT_DINT('t=110 dk ngan bi bo qua', fb.TRANG_THAI, 0);
    (* điều kiện từ t = 120 ⇒ 1 tại t = 150 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=150 => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE);
    KT_DINT('t=160 1 het dk => 3', fb.TRANG_THAI, 3);
    KT_BOOL('t=160 van nhap nhay', fb.NHAP_NHAY, TRUE);
    KT_BOOL('t=160 khong co canh bao', fb.CO_CANH_BAO, FALSE);
    (* điều kiện trở lại từ t = 170: phải qua trễ lại ⇒ 1 tại t = 200 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=170 dk lai chua du tre => 3', fb.TRANG_THAI, 3);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=200 3 => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE);
    KT_BUOC(T#10ms); fb(XAC_NHAN := TRUE);
    KT_DINT('t=220 3 xac nhan => 0', fb.TRANG_THAI, 0);
    KT_BOOL('t=220 het nhap nhay', fb.NHAP_NHAY, FALSE);
    (* XAC_NHAN giữ TRUE từ t = 220: không phải sườn mới khi cảnh báo xuất hiện tại t = 260 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=260 xac nhan giu khong tinh => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(XAC_NHAN := FALSE);
    KT_DINT('t=270 nha xac nhan => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(XAC_NHAN := TRUE);
    KT_DINT('t=280 suon xac nhan => 2', fb.TRANG_THAI, 2);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE, XAC_NHAN := FALSE);
    KT_DINT('t=290 => 0', fb.TRANG_THAI, 0);
    (* 1 tại t = 330; t = 340 xác nhận + hết điều kiện cùng chu kỳ: xác nhận ưu tiên ⇒ 2, rồi 0 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=330 => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE, XAC_NHAN := TRUE);
    KT_DINT('t=340 xac nhan uu tien => 2', fb.TRANG_THAI, 2);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := FALSE);
    KT_DINT('t=350 => 0', fb.TRANG_THAI, 0);
    (* XAC_NHAN vẫn giữ TRUE: cảnh báo mới tại t = 390 phải ở lại 1 *)
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=390 => 1', fb.TRANG_THAI, 1);
    KT_BUOC(T#10ms); fb(DIEU_KIEN := TRUE);
    KT_DINT('t=400 xac nhan giu => van 1', fb.TRANG_THAI, 1);
    main := KT_TONG();
END_FUNCTION
