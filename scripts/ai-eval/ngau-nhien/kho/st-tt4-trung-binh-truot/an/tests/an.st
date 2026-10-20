FUNCTION main : DINT
VAR
    fb : TrungBinhTruot;
END_VAR
    (* chưa có mẫu *)
    fb(MAU := 5.0, LAY_MAU := FALSE);
    KT_REAL('rong => TB 0', fb.TB, 0.0, 0.0001);
    KT_DINT('rong => 0 mau', fb.SO_MAU, 0);
    KT_BOOL('rong => HOP_LE F', fb.HOP_LE, FALSE);

    fb(MAU := 10.0, LAY_MAU := TRUE);
    KT_DINT('suon len nap ngay', fb.SO_MAU, 1);
    KT_REAL('1 mau 10', fb.TB, 10.0, 0.001);
    (* sườn xuống không nạp dù MAU đổi *)
    fb(MAU := 77.0, LAY_MAU := FALSE);
    KT_DINT('suon xuong khong nap', fb.SO_MAU, 1);
    (* giữ LAY_MAU TRUE 3 chu kỳ ⇒ chỉ nạp MỘT mẫu (20) *)
    fb(MAU := 20.0, LAY_MAU := TRUE);
    fb(MAU := 99.0, LAY_MAU := TRUE);
    fb(MAU := 99.0, LAY_MAU := TRUE);
    KT_DINT('giu TRUE chi nap 1', fb.SO_MAU, 2);
    KT_REAL('10,20 => 15', fb.TB, 15.0, 0.001);
    fb(LAY_MAU := FALSE);
    (* nạp 30..70 ⇒ 7 mẫu, tổng 280, TB 40 *)
    fb(MAU := 30.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    fb(MAU := 40.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    fb(MAU := 50.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    fb(MAU := 60.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    fb(MAU := 70.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    KT_DINT('7 mau', fb.SO_MAU, 7);
    KT_REAL('7 mau TB 40', fb.TB, 40.0, 0.001);
    KT_BOOL('7 mau HOP_LE F', fb.HOP_LE, FALSE);
    (* mẫu thứ 8: 80 ⇒ tổng 360, TB 45 *)
    fb(MAU := 80.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    KT_DINT('8 mau', fb.SO_MAU, 8);
    KT_REAL('8 mau TB 45', fb.TB, 45.0, 0.001);
    KT_BOOL('8 mau HOP_LE T', fb.HOP_LE, TRUE);
    (* 90 thay mẫu cũ nhất 10: 360 - 10 + 90 = 440 ⇒ 55 *)
    fb(MAU := 90.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    KT_DINT('van 8 mau', fb.SO_MAU, 8);
    KT_REAL('vong 1 TB 55', fb.TB, 55.0, 0.001);
    (* 100 thay 20: 440 - 20 + 100 = 520 ⇒ 65 *)
    fb(MAU := 100.0, LAY_MAU := TRUE);
    KT_REAL('vong 2 TB 65', fb.TB, 65.0, 0.001);
    fb(MAU := 1000.0, LAY_MAU := FALSE);
    KT_REAL('khong suon => van 65', fb.TB, 65.0, 0.001);
    KT_BOOL('van HOP_LE', fb.HOP_LE, TRUE);
    (* RESET cùng lúc sườn lên LAY_MAU: xoá hết, không nạp *)
    fb(MAU := 3.0, LAY_MAU := TRUE, RESET := TRUE);
    KT_DINT('reset => 0 mau', fb.SO_MAU, 0);
    KT_REAL('reset => TB 0', fb.TB, 0.0, 0.0001);
    KT_BOOL('reset => HOP_LE F', fb.HOP_LE, FALSE);
    (* nhả RESET khi LAY_MAU vẫn TRUE: không phải sườn mới *)
    fb(RESET := FALSE);
    KT_DINT('nha reset khong suon moi', fb.SO_MAU, 0);
    fb(LAY_MAU := FALSE);
    fb(MAU := -4.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    KT_DINT('sau reset 1 mau', fb.SO_MAU, 1);
    KT_REAL('sau reset TB -4 (mau cu da xoa)', fb.TB, -4.0, 0.001);
    fb(MAU := 6.0, LAY_MAU := TRUE); fb(LAY_MAU := FALSE);
    KT_REAL('-4, 6 => TB 1', fb.TB, 1.0, 0.001);
    main := KT_TONG();
END_FUNCTION
