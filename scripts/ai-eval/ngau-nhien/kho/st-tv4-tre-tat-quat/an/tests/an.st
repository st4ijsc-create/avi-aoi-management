FUNCTION main : DINT
VAR
    fb : TreTatQuat;
END_VAR
    (* T_CHAY_THEM = 50ms, bước 10ms *)
    fb(LENH := FALSE, DUNG_KHAN := FALSE, T_CHAY_THEM := T#50ms);
    KT_BOOL('t=0 khong lenh => tat', fb.QUAT, FALSE);
    KT_TIME('t=0 CON_LAI 0', fb.CON_LAI, T#0ms);
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BOOL('t=10 lenh => chay', fb.QUAT, TRUE);
    KT_TIME('t=10 dang lenh CON_LAI 0', fb.CON_LAI, T#0ms);
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    (* LENH FALSE từ t = 30 (mốc 30) ⇒ chạy thêm đến t = 70, tắt tại t = 80 *)
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=30 chay them', fb.QUAT, TRUE);
    KT_TIME('t=30 con 50', fb.CON_LAI, T#50ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_TIME('t=40 con 40', fb.CON_LAI, T#40ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=70 van chay', fb.QUAT, TRUE);
    KT_TIME('t=70 con 10', fb.CON_LAI, T#10ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=80 tat', fb.QUAT, FALSE);
    KT_TIME('t=80 CON_LAI 0', fb.CON_LAI, T#0ms);
    (* lệnh lại trong lúc chạy thêm: đếm lại từ đầu *)
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BOOL('t=120 lenh lai', fb.QUAT, TRUE);
    KT_TIME('t=120 CON_LAI 0', fb.CON_LAI, T#0ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_TIME('t=130 moc moi con 50', fb.CON_LAI, T#50ms);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=170 van chay', fb.QUAT, TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=180 tat', fb.QUAT, FALSE);
    (* DUNG_KHAN trong lúc chạy thêm *)
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_TIME('t=200 con 50', fb.CON_LAI, T#50ms);
    KT_BUOC(T#10ms); fb(DUNG_KHAN := TRUE);
    KT_BOOL('t=210 dung khan => tat ngay', fb.QUAT, FALSE);
    KT_TIME('t=210 CON_LAI 0', fb.CON_LAI, T#0ms);
    KT_BUOC(T#10ms); fb(DUNG_KHAN := FALSE);
    KT_BOOL('t=220 nha dung khan, LENH FALSE => van tat', fb.QUAT, FALSE);
    KT_TIME('t=220 CON_LAI 0', fb.CON_LAI, T#0ms);
    KT_BUOC(T#10ms); fb(DUNG_KHAN := FALSE);
    KT_BOOL('t=230 van tat', fb.QUAT, FALSE);
    (* DUNG_KHAN khi đang có lệnh; nhả khi LENH vẫn TRUE ⇒ chạy lại *)
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BOOL('t=240 lenh moi chay', fb.QUAT, TRUE);
    KT_BUOC(T#10ms); fb(DUNG_KHAN := TRUE);
    KT_BOOL('t=250 dung khan khi co lenh => tat', fb.QUAT, FALSE);
    KT_BUOC(T#10ms); fb(DUNG_KHAN := FALSE);
    KT_BOOL('t=260 nha, LENH TRUE => chay', fb.QUAT, TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_TIME('t=270 chay them con 50', fb.CON_LAI, T#50ms);
    (* DUNG_KHAN cùng lúc có lệnh, rồi LENH FALSE, rồi nhả ⇒ không chạy thêm *)
    KT_BUOC(T#10ms); fb(LENH := TRUE, DUNG_KHAN := TRUE);
    KT_BOOL('t=280 lenh + dung khan => tat', fb.QUAT, FALSE);
    KT_BUOC(T#10ms); fb(LENH := FALSE, DUNG_KHAN := TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE, DUNG_KHAN := FALSE);
    KT_BOOL('t=300 nha sau khi bo lenh => tat', fb.QUAT, FALSE);
    KT_TIME('t=300 CON_LAI 0', fb.CON_LAI, T#0ms);
    (* sau đó hoạt động bình thường *)
    KT_BUOC(T#10ms); fb(LENH := TRUE);
    KT_BUOC(T#10ms); fb(LENH := FALSE);
    KT_BOOL('t=320 chay them binh thuong', fb.QUAT, TRUE);
    KT_TIME('t=320 con 50', fb.CON_LAI, T#50ms);
    main := KT_TONG();
END_FUNCTION
