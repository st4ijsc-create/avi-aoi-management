(* Kịch bản: mỗi lần gọi k chạy n chu kỳ 10 ms; đầu vào giữ nguyên trong n chu kỳ; đếm vi phạm bất biến mọi chu kỳ.
   T_TRE = 50 ms. Mốc tính tay từ đề. *)
FUNCTION_BLOCK KtCanhBang
VAR_INPUT
    st, sp, dk, q1, q2, q3, rs : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : BangTaiTuanTu;
    vi : DINT;
END_VAR
VAR
    i : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        fb(START := st, STOP := sp, DUNG_KHAN := dk, QT1 := q1, QT2 := q2, QT3 := q3, RESET := rs, T_TRE := T#50ms);
        IF (fb.B1 AND NOT fb.B2) OR (fb.B2 AND NOT fb.B3) OR (fb.LOI AND (fb.B1 OR fb.B2 OR fb.B3)) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhBang;
END_VAR
    k(st := FALSE, sp := FALSE, dk := FALSE, q1 := FALSE, q2 := FALSE, q3 := FALSE, rs := FALSE, n := 1);  (* t = 10 *)
    KT_DINT('10 dung', k.fb.TRANG_THAI, 0);
    KT_BOOL('10 B3 tat', k.fb.B3, FALSE);
    k(st := TRUE, n := 1);                     (* t = 20: sườn START => B3 *)
    KT_DINT('20 kd B3', k.fb.TRANG_THAI, 1);
    KT_BOOL('20 B3', k.fb.B3, TRUE);
    KT_BOOL('20 B2 tat', k.fb.B2, FALSE);
    k(n := 3);                                 (* t = 30..50: START vẫn giữ *)
    KT_BOOL('50 B2 chua', k.fb.B2, FALSE);
    k(st := FALSE, n := 2);                    (* t = 60, 70: 20 + 50 => B2 *)
    KT_DINT('70 kd B2', k.fb.TRANG_THAI, 2);
    KT_BOOL('70 B2', k.fb.B2, TRUE);
    KT_BOOL('70 B1 tat', k.fb.B1, FALSE);
    k(n := 4);                                 (* t = 80..110 *)
    KT_BOOL('110 B1 chua', k.fb.B1, FALSE);
    k(n := 1);                                 (* t = 120: 70 + 50 => CHAY *)
    KT_DINT('120 chay', k.fb.TRANG_THAI, 3);
    KT_BOOL('120 B1', k.fb.B1, TRUE);
    k(n := 5);                                 (* t = 130..170 *)
    k(sp := TRUE, n := 1);                     (* t = 180: STOP => dừng B1 ngay *)
    KT_DINT('180 dung B1', k.fb.TRANG_THAI, 4);
    KT_BOOL('180 B1 tat', k.fb.B1, FALSE);
    KT_BOOL('180 B2 van chay', k.fb.B2, TRUE);
    KT_BOOL('180 B3 van chay', k.fb.B3, TRUE);
    k(sp := FALSE, n := 4);                    (* t = 190..220 *)
    KT_DINT('220 van dung B1', k.fb.TRANG_THAI, 4);
    k(n := 1);                                 (* t = 230: 180 + 50 => dừng B2 *)
    KT_DINT('230 dung B2', k.fb.TRANG_THAI, 5);
    KT_BOOL('230 B2 tat', k.fb.B2, FALSE);
    KT_BOOL('230 B3 van chay', k.fb.B3, TRUE);
    k(n := 4);                                 (* t = 240..270 *)
    k(n := 1);                                 (* t = 280: 230 + 50 => DUNG *)
    KT_DINT('280 dung het', k.fb.TRANG_THAI, 0);
    KT_BOOL('280 B3 tat', k.fb.B3, FALSE);
    k(st := TRUE, n := 1);                     (* t = 290: KD_B3 *)
    k(st := FALSE, sp := TRUE, n := 1);        (* t = 300: STOP khi chỉ B3 chạy => DUNG_B2 *)
    KT_DINT('300 stop tu kd B3', k.fb.TRANG_THAI, 5);
    KT_BOOL('300 B3 van chay', k.fb.B3, TRUE);
    k(sp := FALSE, n := 4);                    (* t = 310..340 *)
    KT_DINT('340 van dung B2', k.fb.TRANG_THAI, 5);
    k(n := 1);                                 (* t = 350: 300 + 50 => DUNG *)
    KT_DINT('350 dung', k.fb.TRANG_THAI, 0);
    k(st := TRUE, sp := TRUE, n := 1);         (* t = 360: START khi STOP giữ => không chạy *)
    KT_DINT('360 stop chan start', k.fb.TRANG_THAI, 0);
    k(st := FALSE, sp := FALSE, n := 1);       (* t = 370 *)
    k(st := TRUE, n := 1);                     (* t = 380: KD_B3 *)
    k(st := FALSE, n := 7);                    (* t = 390..450: 430 KD_B2 *)
    k(q2 := TRUE, n := 1);                     (* t = 460: quá tải B2 => LOI ngay *)
    KT_DINT('460 loi', k.fb.TRANG_THAI, 9);
    KT_BOOL('460 LOI', k.fb.LOI, TRUE);
    KT_DINT('460 MA_LOI 12', k.fb.MA_LOI, 12);
    KT_BOOL('460 tat het', k.fb.B1 OR k.fb.B2 OR k.fb.B3, FALSE);
    k(q1 := TRUE, n := 1);                     (* t = 470: nguyên nhân sau không ghi đè *)
    KT_DINT('470 MA_LOI giu 12', k.fb.MA_LOI, 12);
    k(q1 := FALSE, rs := TRUE, n := 1);        (* t = 480: RESET khi QT2 còn => vẫn lỗi *)
    KT_BOOL('480 reset khi con QT => LOI', k.fb.LOI, TRUE);
    KT_DINT('480 van trang thai 9', k.fb.TRANG_THAI, 9);
    k(q2 := FALSE, rs := FALSE, n := 2);       (* t = 490, 500: hết nguyên nhân, chưa RESET *)
    KT_BOOL('500 chua reset => LOI', k.fb.LOI, TRUE);
    k(rs := TRUE, n := 1);                     (* t = 510 *)
    KT_BOOL('510 reset LOI', k.fb.LOI, FALSE);
    KT_DINT('510 ve dung', k.fb.TRANG_THAI, 0);
    KT_DINT('510 MA_LOI 0', k.fb.MA_LOI, 0);
    k(rs := FALSE, n := 1);                    (* t = 520 *)
    k(st := TRUE, n := 1);                     (* t = 530 *)
    KT_DINT('530 khoi dong lai', k.fb.TRANG_THAI, 1);
    k(st := FALSE, n := 10);                   (* t = 540..630: 580 KD_B2, 630 CHAY *)
    KT_DINT('630 chay', k.fb.TRANG_THAI, 3);
    k(dk := TRUE, n := 1);                     (* t = 640: dừng khẩn => tất cả dừng ngay *)
    KT_DINT('640 loi', k.fb.TRANG_THAI, 9);
    KT_DINT('640 MA_LOI 1', k.fb.MA_LOI, 1);
    KT_BOOL('640 B1 tat ngay', k.fb.B1, FALSE);
    k(dk := FALSE, st := TRUE, n := 1);        (* t = 650: START khi đang LOI => bỏ *)
    KT_DINT('650 start khi loi', k.fb.TRANG_THAI, 9);
    k(st := FALSE, rs := TRUE, n := 1);        (* t = 660 *)
    KT_DINT('660 reset', k.fb.TRANG_THAI, 0);
    k(rs := FALSE, st := TRUE, n := 1);        (* t = 670 *)
    k(st := FALSE, dk := TRUE, q3 := TRUE, n := 1);   (* t = 680: đồng thời => dừng khẩn ưu tiên mã *)
    KT_DINT('680 MA_LOI uu tien dung khan', k.fb.MA_LOI, 1);
    KT_DINT('bat bien moi chu ky', k.vi, 0);
    main := KT_TONG();
END_FUNCTION
