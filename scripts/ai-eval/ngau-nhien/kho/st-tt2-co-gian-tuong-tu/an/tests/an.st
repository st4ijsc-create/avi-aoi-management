FUNCTION main : DINT
VAR
    fb : CoGianTuongTu;
    f2 : CoGianTuongTu;
END_VAR
    (* Kỳ vọng tính TAY: GIA_TRI = THAP + THO/27648 * (CAO - THAP), kẹp [min, max]. *)
    (* FB mới, lần gọi đầu đã lỗi: GIA_TRI giữ giá trị ban đầu 0.0 *)
    f2(THO := 32767, KT_THAP := 0.0, KT_CAO := 100.0);
    KT_BOOL('dau tien loi => LOI', f2.LOI, TRUE);
    KT_REAL('dau tien loi => GIA_TRI 0', f2.GIA_TRI, 0.0, 0.0001);

    fb(THO := 0, KT_THAP := 0.0, KT_CAO := 100.0);
    KT_REAL('0 => 0', fb.GIA_TRI, 0.0, 0.01);
    KT_BOOL('0 => LOI F', fb.LOI, FALSE);
    fb(THO := 6912);
    KT_REAL('6912 => 25', fb.GIA_TRI, 25.0, 0.01);
    fb(THO := 30000);
    KT_REAL('30000 => kep 100', fb.GIA_TRI, 100.0, 0.01);
    KT_BOOL('30000 => khong TREN_DAI', fb.TREN_DAI, FALSE);
    fb(THO := 32511);
    KT_BOOL('32511 => khong TREN_DAI', fb.TREN_DAI, FALSE);
    KT_BOOL('32511 => LOI F', fb.LOI, FALSE);
    (* 32512 > 32511 ⇒ lỗi, giữ giá trị hợp lệ cuối = 100 *)
    fb(THO := 32512);
    KT_BOOL('32512 => TREN_DAI', fb.TREN_DAI, TRUE);
    KT_BOOL('32512 => LOI', fb.LOI, TRUE);
    KT_BOOL('32512 => khong DUOI_DAI', fb.DUOI_DAI, FALSE);
    KT_REAL('32512 => giu 100', fb.GIA_TRI, 100.0, 0.01);
    (* -1382 không < -1382 ⇒ hợp lệ, giá trị âm kẹp về 0 *)
    fb(THO := -1382);
    KT_BOOL('-1382 => khong DUOI_DAI', fb.DUOI_DAI, FALSE);
    KT_REAL('-1382 => kep 0', fb.GIA_TRI, 0.0, 0.01);
    fb(THO := 13824);
    KT_REAL('13824 => 50', fb.GIA_TRI, 50.0, 0.01);
    fb(THO := -1383);
    KT_BOOL('-1383 => DUOI_DAI', fb.DUOI_DAI, TRUE);
    KT_BOOL('-1383 => LOI', fb.LOI, TRUE);
    KT_REAL('-1383 => giu 50', fb.GIA_TRI, 50.0, 0.01);
    fb(THO := -32768);
    KT_REAL('-32768 => van giu 50', fb.GIA_TRI, 50.0, 0.01);
    (* hồi phục *)
    fb(THO := 20736);
    KT_BOOL('hoi phuc => LOI F', fb.LOI, FALSE);
    KT_REAL('20736 => 75', fb.GIA_TRI, 75.0, 0.01);

    (* thang 4..20 mA: 13824 ⇒ 4 + 0.5*16 = 12; 6912 ⇒ 4 + 0.25*16 = 8 *)
    fb(THO := 13824, KT_THAP := 4.0, KT_CAO := 20.0);
    KT_REAL('4..20 13824 => 12', fb.GIA_TRI, 12.0, 0.01);
    fb(THO := 6912);
    KT_REAL('4..20 6912 => 8', fb.GIA_TRI, 8.0, 0.01);

    (* thang ĐẢO 100..0: 6912 ⇒ 100 - 25 = 75; 27648 ⇒ 0; -1000 ⇒ >100 kẹp 100; 30000 ⇒ <0 kẹp 0 *)
    fb(THO := 6912, KT_THAP := 100.0, KT_CAO := 0.0);
    KT_REAL('dao 6912 => 75', fb.GIA_TRI, 75.0, 0.01);
    fb(THO := 27648);
    KT_REAL('dao 27648 => 0', fb.GIA_TRI, 0.0, 0.01);
    fb(THO := -1000);
    KT_REAL('dao -1000 => kep 100', fb.GIA_TRI, 100.0, 0.01);
    fb(THO := 30000);
    KT_REAL('dao 30000 => kep 0', fb.GIA_TRI, 0.0, 0.01);

    (* thang -50..50: 13824 ⇒ 0; 20736 ⇒ 25 *)
    fb(THO := 13824, KT_THAP := -50.0, KT_CAO := 50.0);
    KT_REAL('-50..50 13824 => 0', fb.GIA_TRI, 0.0, 0.01);
    fb(THO := 20736);
    KT_REAL('-50..50 20736 => 25', fb.GIA_TRI, 25.0, 0.01);
    main := KT_TONG();
END_FUNCTION
