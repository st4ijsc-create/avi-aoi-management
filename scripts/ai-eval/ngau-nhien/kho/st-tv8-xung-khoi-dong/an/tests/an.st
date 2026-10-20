FUNCTION main : DINT
VAR
    fb : XungKhoiDong;
    fb2 : XungKhoiDong;
END_VAR
    (* T_XUNG = 50ms, bước 10ms *)
    fb(NUT := FALSE, T_XUNG := T#50ms, KHOA := FALSE);
    KT_BOOL('t=0 khong xung', fb.XUNG, FALSE);
    KT_DINT('t=0 so lan 0', fb.SO_LAN, 0);
    (* sườn t = 10 ⇒ xung, kết thúc tại t = 60 *)
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=10 xung', fb.XUNG, TRUE);
    KT_DINT('t=10 so lan 1', fb.SO_LAN, 1);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=30 suon trong xung => van xung', fb.XUNG, TRUE);
    KT_DINT('t=30 suon trong xung khong dem', fb.SO_LAN, 1);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BOOL('t=50 con xung', fb.XUNG, TRUE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BOOL('t=60 het xung dung 50ms', fb.XUNG, FALSE);
    KT_DINT('t=60 so lan van 1', fb.SO_LAN, 1);
    (* sườn t = 70 ⇒ xung mới tới t = 120; sườn ĐÚNG chu kỳ kết thúc (t = 120) bị bỏ *)
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=70 xung moi', fb.XUNG, TRUE);
    KT_DINT('t=70 so lan 2', fb.SO_LAN, 2);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=120 suon o chu ky ket thuc => tat', fb.XUNG, FALSE);
    KT_DINT('t=120 khong dem', fb.SO_LAN, 2);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=130 giu nut khong phai suon', fb.XUNG, FALSE);
    (* sườn t = 150 ⇒ xung; KHOA t = 160 cắt ngay *)
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_DINT('t=150 so lan 3', fb.SO_LAN, 3);
    KT_BUOC(T#10ms); fb(KHOA := TRUE);
    KT_BOOL('t=160 khoa cat xung', fb.XUNG, FALSE);
    KT_BUOC(T#10ms); fb(KHOA := FALSE);
    KT_BOOL('t=170 nha khoa, nut giu => khong xung', fb.XUNG, FALSE);
    KT_DINT('t=170 so lan 3', fb.SO_LAN, 3);
    (* sườn t = 190, trước khi 50ms của xung bị cắt (150..200) hết ⇒ xung mới [190, 240) *)
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=190 xung moi sau khi bi cat', fb.XUNG, TRUE);
    KT_DINT('t=190 so lan 4', fb.SO_LAN, 4);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BOOL('t=230 con xung (do tu 190)', fb.XUNG, TRUE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BOOL('t=240 het xung', fb.XUNG, FALSE);
    (* sườn trong lúc KHOA: bỏ qua, không đếm *)
    KT_BUOC(T#10ms); fb(NUT := TRUE, KHOA := TRUE);
    KT_BOOL('t=250 suon khi khoa => khong xung', fb.XUNG, FALSE);
    KT_DINT('t=250 khong dem', fb.SO_LAN, 4);
    KT_BUOC(T#10ms); fb(NUT := TRUE, KHOA := FALSE);
    KT_BOOL('t=260 nha khoa khi nut giu => khong xung', fb.XUNG, FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('t=280 suon binh thuong => xung', fb.XUNG, TRUE);
    KT_DINT('t=280 so lan 5', fb.SO_LAN, 5);

    (* lần gọi đầu NUT = TRUE là sườn lên *)
    fb2(NUT := TRUE, T_XUNG := T#20ms, KHOA := FALSE);
    KT_BOOL('goi dau NUT TRUE => xung', fb2.XUNG, TRUE);
    KT_DINT('goi dau so lan 1', fb2.SO_LAN, 1);
    main := KT_TONG();
END_FUNCTION
