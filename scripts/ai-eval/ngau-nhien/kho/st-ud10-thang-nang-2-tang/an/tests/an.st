(* Kịch bản thang: vị trí x 0..100 (tầng 1 = 0, tầng 2 = 100), trước mỗi lần gọi x += 10 nếu chu kỳ trước LEN,
   -= 10 nếu XUONG (trừ khi kẹt). CT_TANG_1 = x <= 0, CT_TANG_2 = x >= 100. T_DI_CHUYEN 150 ms, chu kỳ 10 ms.
   Đếm vi phạm bất biến mọi chu kỳ. *)
FUNCTION_BLOCK KtCanhThang
VAR_INPUT
    g1, g2, cua, dk, rs, ket : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : ThangNang2Tang;
    vi : DINT;
    x : INT;
END_VAR
VAR
    i : INT;
    ct1, ct2 : BOOL;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        IF NOT ket THEN
            IF fb.LEN THEN x := x + 10; END_IF
            IF fb.XUONG THEN x := x - 10; END_IF
            IF x < 0 THEN x := 0; END_IF
            IF x > 100 THEN x := 100; END_IF
        END_IF
        ct1 := x <= 0;
        ct2 := x >= 100;
        fb(GOI_1 := g1, GOI_2 := g2, CT_TANG_1 := ct1, CT_TANG_2 := ct2, CUA_DONG := cua, DUNG_KHAN := dk,
           RESET := rs, T_DI_CHUYEN := T#150ms);
        IF (fb.LEN AND fb.XUONG) OR ((fb.LEN OR fb.XUONG) AND (NOT cua OR dk))
           OR (fb.LEN AND ct2) OR (fb.XUONG AND ct1) OR (fb.TRANG_THAI = 9 AND (fb.LEN OR fb.XUONG)) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhThang;
    kd : KhoaDongCo;
END_VAR
    k(g1 := FALSE, g2 := FALSE, cua := TRUE, dk := FALSE, rs := FALSE, ket := FALSE, n := 1);   (* t = 10 *)
    KT_DINT('10 dung yen', k.fb.TRANG_THAI, 0);
    KT_DINT('10 tang 1', k.fb.TANG, 1);
    k(g2 := TRUE, n := 1);                     (* t = 20: gọi tầng 2 *)
    KT_DINT('20 di len', k.fb.TRANG_THAI, 1);
    KT_BOOL('20 LEN', k.fb.LEN, TRUE);
    k(g2 := FALSE, n := 9);                    (* t = 30..110: x 10..90 *)
    KT_BOOL('110 van LEN', k.fb.LEN, TRUE);
    k(n := 1);                                 (* t = 120: x 100 => dừng ở tầng 2 *)
    KT_DINT('120 dung yen', k.fb.TRANG_THAI, 0);
    KT_BOOL('120 LEN tat', k.fb.LEN, FALSE);
    KT_DINT('120 tang 2', k.fb.TANG, 2);
    k(g2 := TRUE, n := 1);                     (* t = 130: gọi tầng đang đứng => bỏ *)
    KT_DINT('130 goi tang dang o', k.fb.TRANG_THAI, 0);
    k(g2 := FALSE, n := 1);                    (* t = 140 *)
    k(cua := FALSE, g1 := TRUE, n := 1);       (* t = 150: gọi khi cửa mở => bỏ, không nhớ *)
    KT_DINT('150 cua mo => khong di', k.fb.TRANG_THAI, 0);
    KT_BOOL('150 XUONG tat', k.fb.XUONG, FALSE);
    k(g1 := FALSE, n := 1);                    (* t = 160 *)
    k(cua := TRUE, n := 1);                    (* t = 170: đóng cửa, lời gọi cũ không được nhớ *)
    KT_DINT('170 khong nho loi goi', k.fb.TRANG_THAI, 0);
    k(g1 := TRUE, n := 1);                     (* t = 180: đi xuống *)
    KT_DINT('180 di xuong', k.fb.TRANG_THAI, 2);
    KT_BOOL('180 XUONG', k.fb.XUONG, TRUE);
    k(g1 := FALSE, n := 3);                    (* t = 190..210: x 90..70 *)
    k(cua := FALSE, n := 1);                   (* t = 220: x 60, cửa mở khi chạy => dừng, huỷ lời gọi *)
    KT_DINT('220 cua mo => dung yen', k.fb.TRANG_THAI, 0);
    KT_BOOL('220 XUONG tat', k.fb.XUONG, FALSE);
    k(n := 2);                                 (* t = 230, 240 *)
    k(cua := TRUE, n := 2);                    (* t = 250, 260: không tự chạy lại *)
    KT_DINT('260 khong tu chay lai', k.fb.TRANG_THAI, 0);
    k(g1 := TRUE, n := 1);                     (* t = 270: x 60 => đi xuống *)
    k(g1 := FALSE, n := 5);                    (* t = 280..320: x 50..10 *)
    KT_DINT('320 van di xuong', k.fb.TRANG_THAI, 2);
    k(n := 1);                                 (* t = 330: x 0 => tầng 1 *)
    KT_DINT('330 dung yen', k.fb.TRANG_THAI, 0);
    KT_DINT('330 tang 1', k.fb.TANG, 1);
    k(ket := TRUE, g2 := TRUE, n := 1);        (* t = 340: đi lên nhưng kẹt *)
    k(g2 := FALSE, n := 14);                   (* t = 350..480 *)
    KT_DINT('480 van di len', k.fb.TRANG_THAI, 1);
    KT_BOOL('480 LEN', k.fb.LEN, TRUE);
    k(n := 1);                                 (* t = 490: 340 + 150 => lỗi quá giờ *)
    KT_DINT('490 loi', k.fb.TRANG_THAI, 9);
    KT_DINT('490 MA_LOI 1', k.fb.MA_LOI, 1);
    KT_BOOL('490 LEN tat', k.fb.LEN, FALSE);
    k(g1 := TRUE, n := 1);                     (* t = 500: gọi khi lỗi => bỏ *)
    KT_DINT('500 van loi', k.fb.TRANG_THAI, 9);
    k(g1 := FALSE, ket := FALSE, rs := TRUE, n := 1);   (* t = 510: RESET *)
    KT_DINT('510 reset', k.fb.TRANG_THAI, 0);
    KT_DINT('510 MA_LOI 0', k.fb.MA_LOI, 0);
    k(rs := FALSE, n := 1);                    (* t = 520 *)
    k(g2 := TRUE, n := 1);                     (* t = 530: đi lên từ x 0 *)
    k(g2 := FALSE, n := 3);                    (* t = 540..560: x 10..30 *)
    k(dk := TRUE, n := 1);                     (* t = 570: x 40, dừng khẩn *)
    KT_DINT('570 dung khan', k.fb.TRANG_THAI, 9);
    KT_DINT('570 MA_LOI 2', k.fb.MA_LOI, 2);
    KT_BOOL('570 LEN tat ngay', k.fb.LEN, FALSE);
    k(rs := TRUE, n := 1);                     (* t = 580: RESET khi dừng khẩn còn => vẫn lỗi *)
    KT_DINT('580 van loi', k.fb.TRANG_THAI, 9);
    k(dk := FALSE, rs := FALSE, n := 1);       (* t = 590: nhả dừng khẩn, chưa RESET *)
    KT_DINT('590 chot loi', k.fb.TRANG_THAI, 9);
    k(rs := TRUE, n := 1);                     (* t = 600 *)
    KT_DINT('600 reset', k.fb.TRANG_THAI, 0);
    KT_DINT('600 MA_LOI 0', k.fb.MA_LOI, 0);
    KT_DINT('600 tang gan nhat 1', k.fb.TANG, 1);
    k(rs := FALSE, n := 1);                    (* t = 610 *)
    k(g1 := TRUE, g2 := TRUE, n := 1);         (* t = 620: gọi cả hai => bỏ *)
    KT_DINT('620 goi ca hai', k.fb.TRANG_THAI, 0);
    k(g1 := FALSE, g2 := FALSE, n := 1);       (* t = 630 *)
    k(g1 := TRUE, n := 1);                     (* t = 640: x 40 => đi xuống *)
    k(g1 := FALSE, n := 3);                    (* t = 650..670: x 30, 20, 10 *)
    KT_DINT('670 van di xuong', k.fb.TRANG_THAI, 2);
    k(n := 1);                                 (* t = 680: x 0 => dừng *)
    KT_DINT('680 dung yen', k.fb.TRANG_THAI, 0);
    KT_BOOL('680 XUONG tat', k.fb.XUONG, FALSE);
    k(dk := TRUE, n := 1);                     (* t = 690: dừng khẩn khi đứng yên *)
    KT_DINT('690 dung khan', k.fb.MA_LOI, 2);
    k(dk := FALSE, rs := TRUE, n := 1);        (* t = 700 *)
    KT_DINT('700 reset', k.fb.TRANG_THAI, 0);
    KT_DINT('bat bien moi chu ky', k.vi, 0);

    kd(YC_LEN := TRUE, YC_XUONG := FALSE, CUA_DONG := TRUE, DUNG_KHAN := FALSE);
    KT_BOOL('khoa len', kd.LEN, TRUE);
    kd(CUA_DONG := FALSE);
    KT_BOOL('khoa cua mo', kd.LEN, FALSE);
    kd(CUA_DONG := TRUE, DUNG_KHAN := TRUE);
    KT_BOOL('khoa dung khan', kd.LEN, FALSE);
    kd(YC_LEN := TRUE, YC_XUONG := TRUE, DUNG_KHAN := FALSE);
    KT_BOOL('khoa hai yeu cau', kd.LEN OR kd.XUONG, FALSE);
    main := KT_TONG();
END_FUNCTION
