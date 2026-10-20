(* Kịch bản: mỗi lần gọi k chạy n chu kỳ 10 ms (KT_BUOC trước mỗi lần gọi khối), đếm vi phạm bất biến mọi chu kỳ.
   T_XANH_MIN 100, T_VANG 30, T_NGUOI 50, T_DO_CHUNG 20, T_NHAY 20 (ms). Lần gọi đầu ở t = 10 => vào XANH_XE tại 10. *)
FUNCTION_BLOCK KtCanhDen
VAR_INPUT
    nut, nhay : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : DenGiaoThong;
    vi : DINT;
END_VAR
VAR
    i : INT;
    soXe, soNg : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        fb(NUT_NGUOI := nut, NHAP_NHAY_VANG := nhay, T_XANH_MIN := T#100ms, T_VANG := T#30ms,
           T_NGUOI := T#50ms, T_DO_CHUNG := T#20ms, T_NHAY := T#20ms);
        soXe := BOOL_TO_INT(fb.XE_XANH) + BOOL_TO_INT(fb.XE_VANG) + BOOL_TO_INT(fb.XE_DO);
        soNg := BOOL_TO_INT(fb.NG_XANH) + BOOL_TO_INT(fb.NG_DO);
        IF (fb.XE_XANH AND fb.NG_XANH) OR soXe > 1 OR soNg > 1 THEN
            vi := vi + 1;
        ELSIF fb.TRANG_THAI = 4 AND (fb.XE_XANH OR fb.XE_DO OR fb.NG_XANH OR fb.NG_DO) THEN
            vi := vi + 1;
        ELSIF fb.TRANG_THAI <> 4 AND (soXe <> 1 OR soNg <> 1) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhDen;
    nn : NhapNhay;
END_VAR
    k(nut := FALSE, nhay := FALSE, n := 1);                     (* t = 10 *)
    KT_DINT('10 xanh xe', k.fb.TRANG_THAI, 0);
    KT_BOOL('10 XE_XANH', k.fb.XE_XANH, TRUE);
    KT_BOOL('10 NG_DO', k.fb.NG_DO, TRUE);
    k(n := 2);                                                  (* t = 20, 30 *)
    k(nut := TRUE, n := 1);                                     (* t = 40: bấm nút, chưa đủ 100 ms xanh *)
    k(nut := FALSE, n := 6);                                    (* t = 50..100 *)
    KT_DINT('100 van xanh (moi 90 ms)', k.fb.TRANG_THAI, 0);
    k(n := 1);                                                  (* t = 110: 10 + 100 => VANG *)
    KT_DINT('110 vang', k.fb.TRANG_THAI, 1);
    KT_BOOL('110 XE_VANG', k.fb.XE_VANG, TRUE);
    KT_BOOL('110 XE_XANH tat', k.fb.XE_XANH, FALSE);
    k(n := 2);                                                  (* t = 120, 130 *)
    KT_DINT('130 van vang', k.fb.TRANG_THAI, 1);
    k(n := 1);                                                  (* t = 140: 110 + 30 => NGUOI_DI *)
    KT_DINT('140 nguoi di', k.fb.TRANG_THAI, 2);
    KT_BOOL('140 NG_XANH', k.fb.NG_XANH, TRUE);
    KT_BOOL('140 XE_DO', k.fb.XE_DO, TRUE);
    k(n := 1);                                                  (* t = 150 *)
    k(nut := TRUE, n := 1);                                     (* t = 160: nút khi không xanh xe => bỏ *)
    k(nut := FALSE, n := 2);                                    (* t = 170, 180 *)
    KT_DINT('180 van nguoi di', k.fb.TRANG_THAI, 2);
    k(n := 1);                                                  (* t = 190: 140 + 50 => DO_CHUNG *)
    KT_DINT('190 do chung', k.fb.TRANG_THAI, 3);
    KT_BOOL('190 NG_XANH tat', k.fb.NG_XANH, FALSE);
    k(n := 1);                                                  (* t = 200 *)
    KT_DINT('200 van do chung', k.fb.TRANG_THAI, 3);
    k(n := 1);                                                  (* t = 210: 190 + 20 => XANH_XE *)
    KT_DINT('210 xanh xe', k.fb.TRANG_THAI, 0);
    k(n := 18);                                                 (* t = 220..390: không có yêu cầu *)
    KT_DINT('390 khong yeu cau => van xanh', k.fb.TRANG_THAI, 0);
    k(nut := TRUE, n := 1);                                     (* t = 400: đã xanh 190 ms => VANG ngay *)
    KT_DINT('400 vang ngay', k.fb.TRANG_THAI, 1);
    k(nut := FALSE, n := 10);                                   (* t = 410..500: 430 NGUOI, 480 DO, 500 XANH *)
    KT_DINT('500 xanh xe', k.fb.TRANG_THAI, 0);
    k(n := 1);                                                  (* t = 510 *)
    k(nhay := TRUE, n := 1);                                    (* t = 520: NHAP_NHAY, vàng sáng *)
    KT_DINT('520 nhap nhay', k.fb.TRANG_THAI, 4);
    KT_BOOL('520 XE_VANG sang', k.fb.XE_VANG, TRUE);
    KT_BOOL('520 XE_XANH tat', k.fb.XE_XANH, FALSE);
    KT_BOOL('520 NG_DO tat', k.fb.NG_DO, FALSE);
    k(n := 1);                                                  (* t = 530 *)
    KT_BOOL('530 vang sang', k.fb.XE_VANG, TRUE);
    k(n := 1);                                                  (* t = 540: đảo *)
    KT_BOOL('540 vang tat', k.fb.XE_VANG, FALSE);
    k(n := 2);                                                  (* t = 550, 560: đảo ở 560 *)
    KT_BOOL('560 vang sang lai', k.fb.XE_VANG, TRUE);
    k(n := 3);                                                  (* t = 570..590 *)
    k(nhay := FALSE, n := 1);                                   (* t = 600: hết lỗi => DO_CHUNG *)
    KT_DINT('600 do chung', k.fb.TRANG_THAI, 3);
    KT_BOOL('600 XE_DO', k.fb.XE_DO, TRUE);
    KT_BOOL('600 NG_DO', k.fb.NG_DO, TRUE);
    k(n := 2);                                                  (* t = 610, 620 *)
    KT_DINT('620 xanh xe', k.fb.TRANG_THAI, 0);
    k(nut := TRUE, n := 1);                                     (* t = 630 *)
    k(nut := FALSE, n := 9);                                    (* t = 640..720: 620 + 100 => VANG *)
    KT_DINT('720 vang', k.fb.TRANG_THAI, 1);
    k(n := 3);                                                  (* t = 730..750: 750 NGUOI_DI *)
    KT_DINT('750 nguoi di', k.fb.TRANG_THAI, 2);
    k(n := 1);                                                  (* t = 760 *)
    k(nhay := TRUE, n := 1);                                    (* t = 770: lỗi khi người đang đi => ưu tiên *)
    KT_DINT('770 nhap nhay', k.fb.TRANG_THAI, 4);
    KT_BOOL('770 NG_XANH tat', k.fb.NG_XANH, FALSE);
    KT_BOOL('770 XE_VANG', k.fb.XE_VANG, TRUE);
    k(nut := TRUE, n := 1);                                     (* t = 780: nút khi nhấp nháy => bỏ *)
    k(nut := FALSE, n := 1);                                    (* t = 790 *)
    k(nhay := FALSE, n := 1);                                   (* t = 800 *)
    KT_DINT('800 do chung', k.fb.TRANG_THAI, 3);
    k(n := 2);                                                  (* t = 810, 820 *)
    KT_DINT('820 xanh xe', k.fb.TRANG_THAI, 0);
    k(nut := TRUE, n := 1);                                     (* t = 830: yêu cầu, mới xanh 10 ms *)
    k(nut := FALSE, n := 1);                                    (* t = 840 *)
    k(nhay := TRUE, n := 1);                                    (* t = 850: NHAP_NHAY => yêu cầu bị xoá *)
    k(nhay := FALSE, n := 1);                                   (* t = 860: DO_CHUNG *)
    k(n := 2);                                                  (* t = 870, 880: 860 + 20 => XANH_XE *)
    KT_DINT('880 xanh xe', k.fb.TRANG_THAI, 0);
    k(n := 15);                                                 (* t = 890..1030: yêu cầu cũ đã xoá *)
    KT_DINT('1030 yeu cau da xoa => van xanh', k.fb.TRANG_THAI, 0);
    KT_DINT('bat bien moi chu ky', k.vi, 0);

    (* NhapNhay riêng: bật ở t = 1040 (gọi là t0), T_NUA 30 ms *)
    KT_BUOC(T#10ms);
    nn(EN := TRUE, T_NUA := T#30ms);                            (* t0 *)
    KT_BOOL('nn bat => Q', nn.Q, TRUE);
    KT_BUOC(T#20ms);
    nn();                                                       (* t0 + 20: mới 20 ms *)
    KT_BOOL('nn 20ms van Q', nn.Q, TRUE);
    KT_BUOC(T#10ms);
    nn();                                                       (* t0 + 30: đủ 30 => đảo *)
    KT_BOOL('nn 30ms dao', nn.Q, FALSE);
    KT_BUOC(T#30ms);
    nn();                                                       (* t0 + 60 *)
    KT_BOOL('nn 60ms dao lai', nn.Q, TRUE);
    KT_BUOC(T#10ms);
    nn(EN := FALSE);
    KT_BOOL('nn tat EN', nn.Q, FALSE);
    main := KT_TONG();
END_FUNCTION
