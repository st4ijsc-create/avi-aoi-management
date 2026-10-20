(* Kịch bản: mỗi chu kỳ 10 ms, mô phỏng mức TRƯỚC khi gọi khối theo đầu ra chu kỳ trước:
   +2.0 khi VAN_A hoặc VAN_B mở, -3.0 khi VAN_XA mở (không dưới 0). MUC_A 20, MUC_B 10, MUC_RONG 1, T_TRON 100 ms.
   Đếm vi phạm bất biến mọi chu kỳ. *)
FUNCTION_BLOCK KtCanhTron
VAR_INPUT
    st, sp : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : MayTronMe;
    vi : DINT;
    muc : REAL;
END_VAR
VAR
    i : INT;
    soVan : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        IF fb.VAN_A OR fb.VAN_B THEN muc := muc + 2.0; END_IF
        IF fb.VAN_XA THEN muc := muc - 3.0; END_IF
        IF muc < 0.0 THEN muc := 0.0; END_IF
        fb(START := st, STOP := sp, MUC := muc, MUC_A := 20.0, MUC_B := 10.0, MUC_RONG := 1.0, T_TRON := T#100ms);
        soVan := BOOL_TO_INT(fb.VAN_A) + BOOL_TO_INT(fb.VAN_B) + BOOL_TO_INT(fb.VAN_XA);
        IF soVan > 1 OR (fb.MOTOR AND soVan > 0) OR (fb.TRANG_THAI = 6 AND (soVan > 0 OR fb.MOTOR)) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhTron;
    kv : KhoaLienDongVan;
END_VAR
    k(st := FALSE, sp := FALSE, n := 1);       (* t = 10 *)
    KT_DINT('10 cho', k.fb.TRANG_THAI, 0);
    k(st := TRUE, n := 1);                     (* t = 20: CAP_A, mức 0 *)
    KT_DINT('20 cap A', k.fb.TRANG_THAI, 1);
    KT_BOOL('20 VAN_A', k.fb.VAN_A, TRUE);
    k(st := FALSE, n := 9);                    (* t = 30..110: mức 2..18 *)
    KT_DINT('110 van cap A (muc 18)', k.fb.TRANG_THAI, 1);
    KT_BOOL('110 VAN_A', k.fb.VAN_A, TRUE);
    k(n := 1);                                 (* t = 120: mức 20 >= 20 => CAP_B *)
    KT_DINT('120 cap B', k.fb.TRANG_THAI, 2);
    KT_BOOL('120 VAN_B', k.fb.VAN_B, TRUE);
    KT_BOOL('120 VAN_A dong', k.fb.VAN_A, FALSE);
    k(n := 4);                                 (* t = 130..160: mức 22..28 *)
    KT_DINT('160 van cap B', k.fb.TRANG_THAI, 2);
    k(n := 1);                                 (* t = 170: mức 30 => TRON *)
    KT_DINT('170 tron', k.fb.TRANG_THAI, 3);
    KT_BOOL('170 MOTOR', k.fb.MOTOR, TRUE);
    KT_BOOL('170 VAN_B dong', k.fb.VAN_B, FALSE);
    k(n := 9);                                 (* t = 180..260 *)
    KT_DINT('260 van tron', k.fb.TRANG_THAI, 3);
    k(n := 1);                                 (* t = 270: 170 + 100 => XA *)
    KT_DINT('270 xa', k.fb.TRANG_THAI, 4);
    KT_BOOL('270 VAN_XA', k.fb.VAN_XA, TRUE);
    KT_BOOL('270 MOTOR tat', k.fb.MOTOR, FALSE);
    k(n := 9);                                 (* t = 280..360: mức 27..3 *)
    KT_DINT('360 van xa (muc 3)', k.fb.TRANG_THAI, 4);
    k(n := 1);                                 (* t = 370: mức 0 <= 1 => XONG *)
    KT_DINT('370 xong', k.fb.TRANG_THAI, 5);
    KT_DINT('370 SO_ME 1', k.fb.SO_ME, 1);
    KT_BOOL('370 VAN_XA dong', k.fb.VAN_XA, FALSE);
    k(n := 1);                                 (* t = 380: XONG => CHO *)
    KT_DINT('380 cho', k.fb.TRANG_THAI, 0);

    (* Mẻ 2 *)
    k(st := TRUE, n := 1);                     (* t = 390: CAP_A, mức 0 *)
    k(st := FALSE, n := 4);                    (* t = 400..430: mức 2..8 *)
    k(sp := TRUE, n := 1);                     (* t = 440: mức 10, STOP => TAM_DUNG *)
    KT_DINT('440 tam dung', k.fb.TRANG_THAI, 6);
    KT_BOOL('440 VAN_A dong', k.fb.VAN_A, FALSE);
    k(n := 3);                                 (* t = 450..470 *)
    k(st := TRUE, n := 1);                     (* t = 480: START khi STOP còn giữ => không chạy *)
    KT_DINT('480 stop chan start', k.fb.TRANG_THAI, 6);
    k(st := FALSE, sp := FALSE, n := 1);       (* t = 490 *)
    k(st := TRUE, n := 1);                     (* t = 500: tiếp tục CAP_A, mức 10 *)
    KT_DINT('500 tiep tuc cap A', k.fb.TRANG_THAI, 1);
    KT_BOOL('500 VAN_A', k.fb.VAN_A, TRUE);
    k(st := FALSE, n := 4);                    (* t = 510..540: mức 12..18 *)
    k(n := 1);                                 (* t = 550: mức 20 => CAP_B *)
    KT_DINT('550 cap B', k.fb.TRANG_THAI, 2);
    k(n := 5);                                 (* t = 560..600: mức 22..30 => TRON tại 600 *)
    KT_DINT('600 tron', k.fb.TRANG_THAI, 3);
    k(n := 4);                                 (* t = 610..640 *)
    k(sp := TRUE, n := 1);                     (* t = 650: tạm dừng khi trộn *)
    KT_DINT('650 tam dung', k.fb.TRANG_THAI, 6);
    KT_BOOL('650 MOTOR tat', k.fb.MOTOR, FALSE);
    k(sp := FALSE, n := 2);                    (* t = 660, 670 *)
    k(st := TRUE, n := 1);                     (* t = 680: tiếp tục TRON, đếm lại đủ 100 ms *)
    KT_DINT('680 tiep tuc tron', k.fb.TRANG_THAI, 3);
    KT_BOOL('680 MOTOR', k.fb.MOTOR, TRUE);
    k(st := FALSE, n := 9);                    (* t = 690..770 *)
    KT_DINT('770 van tron', k.fb.TRANG_THAI, 3);
    k(n := 1);                                 (* t = 780: 680 + 100 => XA *)
    KT_DINT('780 xa', k.fb.TRANG_THAI, 4);
    k(n := 10);                                (* t = 790..880: mức 27..0 => XONG tại 880 *)
    KT_DINT('880 xong', k.fb.TRANG_THAI, 5);
    KT_DINT('880 SO_ME 2', k.fb.SO_ME, 2);
    k(n := 1);                                 (* t = 890 *)
    k(sp := TRUE, n := 1);                     (* t = 900: STOP ở CHO không tác dụng *)
    KT_DINT('900 stop o cho', k.fb.TRANG_THAI, 0);
    KT_DINT('bat bien moi chu ky', k.vi, 0);

    (* KhoaLienDongVan riêng *)
    kv(YC_A := TRUE, YC_B := FALSE, YC_XA := FALSE);
    KT_BOOL('khoa mot yeu cau', kv.VAN_A, TRUE);
    KT_BOOL('khoa mot yeu cau khong xung dot', kv.XUNG_DOT, FALSE);
    kv(YC_A := TRUE, YC_B := FALSE, YC_XA := TRUE);
    KT_BOOL('khoa hai yeu cau => dong A', kv.VAN_A, FALSE);
    KT_BOOL('khoa hai yeu cau => dong XA', kv.VAN_XA, FALSE);
    KT_BOOL('khoa hai yeu cau => XUNG_DOT', kv.XUNG_DOT, TRUE);
    main := KT_TONG();
END_FUNCTION
