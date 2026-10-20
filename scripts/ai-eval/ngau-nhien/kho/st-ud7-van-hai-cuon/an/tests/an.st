(* Kịch bản van: vị trí p 0..100, trước mỗi lần gọi p += 10 nếu chu kỳ trước CUON_MO, -= 10 nếu CUON_DONG
   (trừ khi kẹt). CT_DONG = p <= 0, CT_MO = p >= 100; haiCT = ép cả hai công tắc TRUE. T_HANH_TRINH 150 ms.
   Đếm vi phạm bất biến mọi chu kỳ (kể cả đảo chiều không qua chu kỳ nghỉ). *)
FUNCTION_BLOCK KtCanhVan
VAR_INPUT
    mo, dong, rs, ket, haiCT : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : VanHaiCuon;
    vi : DINT;
    p : INT;
END_VAR
VAR
    i : INT;
    ctMo, ctDong, moTruoc, dongTruoc : BOOL;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        moTruoc := fb.CUON_MO;
        dongTruoc := fb.CUON_DONG;
        IF NOT ket THEN
            IF fb.CUON_MO THEN p := p + 10; END_IF
            IF fb.CUON_DONG THEN p := p - 10; END_IF
            IF p < 0 THEN p := 0; END_IF
            IF p > 100 THEN p := 100; END_IF
        END_IF
        ctMo := p >= 100 OR haiCT;
        ctDong := p <= 0 OR haiCT;
        fb(MO := mo, DONG := dong, CT_MO := ctMo, CT_DONG := ctDong, RESET := rs, T_HANH_TRINH := T#150ms);
        IF (fb.CUON_MO AND fb.CUON_DONG) OR (moTruoc AND fb.CUON_DONG) OR (dongTruoc AND fb.CUON_MO)
           OR (fb.TRANG_THAI = 9 AND (fb.CUON_MO OR fb.CUON_DONG))
           OR (fb.CUON_MO AND ctMo) OR (fb.CUON_DONG AND ctDong) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhVan;
END_VAR
    k(mo := FALSE, dong := FALSE, rs := FALSE, ket := FALSE, haiCT := FALSE, n := 1);   (* t = 10, p = 0 *)
    KT_DINT('10 da dong', k.fb.TRANG_THAI, 4);
    k(mo := TRUE, n := 1);                     (* t = 20: lệnh mở *)
    KT_DINT('20 dang mo', k.fb.TRANG_THAI, 1);
    KT_BOOL('20 cuon mo', k.fb.CUON_MO, TRUE);
    k(mo := FALSE, n := 9);                    (* t = 30..110: p 10..90 *)
    KT_DINT('110 van dang mo', k.fb.TRANG_THAI, 1);
    k(n := 1);                                 (* t = 120: p 100 => tới hành trình *)
    KT_DINT('120 da mo', k.fb.TRANG_THAI, 3);
    KT_BOOL('120 cuon mo nha', k.fb.CUON_MO, FALSE);
    k(mo := TRUE, n := 1);                     (* t = 130: MO khi đã mở => bỏ *)
    KT_DINT('130 mo khi da mo', k.fb.TRANG_THAI, 3);
    KT_BOOL('130 khong cap cuon', k.fb.CUON_MO, FALSE);
    k(mo := FALSE, n := 1);                    (* t = 140 *)
    k(dong := TRUE, n := 1);                   (* t = 150: lệnh đóng *)
    KT_DINT('150 dang dong', k.fb.TRANG_THAI, 2);
    KT_BOOL('150 cuon dong', k.fb.CUON_DONG, TRUE);
    k(dong := FALSE, n := 3);                  (* t = 160..180: p 90..70 *)
    k(mo := TRUE, n := 1);                     (* t = 190: lệnh ngược chiều => một chu kỳ nghỉ *)
    KT_DINT('190 dao => dang mo', k.fb.TRANG_THAI, 1);
    KT_BOOL('190 nghi cuon mo', k.fb.CUON_MO, FALSE);
    KT_BOOL('190 nghi cuon dong', k.fb.CUON_DONG, FALSE);
    k(mo := FALSE, n := 1);                    (* t = 200: cấp cuộn mở, p 60 *)
    KT_BOOL('200 cuon mo', k.fb.CUON_MO, TRUE);
    k(n := 3);                                 (* t = 210..230: p 70..90 *)
    KT_DINT('230 dang mo', k.fb.TRANG_THAI, 1);
    k(n := 1);                                 (* t = 240: p 100 *)
    KT_DINT('240 da mo', k.fb.TRANG_THAI, 3);
    k(ket := TRUE, dong := TRUE, n := 1);      (* t = 250: đóng nhưng van kẹt; bắt đầu đếm hành trình *)
    k(dong := FALSE, n := 14);                 (* t = 260..390 *)
    KT_DINT('390 van dang dong', k.fb.TRANG_THAI, 2);
    KT_BOOL('390 cuon dong', k.fb.CUON_DONG, TRUE);
    k(n := 1);                                 (* t = 400: 250 + 150 => lỗi hành trình *)
    KT_DINT('400 loi', k.fb.TRANG_THAI, 9);
    KT_DINT('400 MA_LOI 1', k.fb.MA_LOI, 1);
    KT_BOOL('400 cat cuon', k.fb.CUON_DONG, FALSE);
    k(mo := TRUE, n := 1);                     (* t = 410: lệnh khi lỗi => bỏ *)
    KT_DINT('410 van loi', k.fb.TRANG_THAI, 9);
    k(mo := FALSE, n := 1);                    (* t = 420 *)
    k(ket := FALSE, rs := TRUE, n := 1);       (* t = 430: RESET, p = 100 *)
    KT_DINT('430 reset => da mo', k.fb.TRANG_THAI, 3);
    KT_DINT('430 MA_LOI 0', k.fb.MA_LOI, 0);
    k(rs := FALSE, n := 1);                    (* t = 440 *)
    k(mo := TRUE, dong := TRUE, n := 1);       (* t = 450: hai lệnh cùng lúc => bỏ cả hai *)
    KT_DINT('450 hai lenh => bo', k.fb.TRANG_THAI, 3);
    KT_BOOL('450 khong cap cuon dong', k.fb.CUON_DONG, FALSE);
    k(mo := FALSE, dong := FALSE, n := 1);     (* t = 460 *)
    k(dong := TRUE, n := 1);                   (* t = 470: đang đóng *)
    k(dong := FALSE, haiCT := TRUE, n := 1);   (* t = 480: hai công tắc cùng TRUE *)
    KT_DINT('480 loi cong tac', k.fb.TRANG_THAI, 9);
    KT_DINT('480 MA_LOI 2', k.fb.MA_LOI, 2);
    KT_BOOL('480 cat cuon', k.fb.CUON_DONG, FALSE);
    k(rs := TRUE, n := 1);                     (* t = 490: RESET khi còn hai công tắc => vẫn lỗi *)
    KT_DINT('490 van loi', k.fb.TRANG_THAI, 9);
    k(haiCT := FALSE, n := 1);                 (* t = 500: RESET, p = 90 *)
    KT_DINT('500 reset => giua chung', k.fb.TRANG_THAI, 5);
    KT_DINT('500 MA_LOI 0', k.fb.MA_LOI, 0);
    k(rs := FALSE, n := 1);                    (* t = 510 *)
    k(dong := TRUE, n := 1);                   (* t = 520: đóng từ p = 90 *)
    k(dong := FALSE, n := 8);                  (* t = 530..600: p 80..10 *)
    KT_DINT('600 dang dong', k.fb.TRANG_THAI, 2);
    k(n := 1);                                 (* t = 610: p 0 *)
    KT_DINT('610 da dong', k.fb.TRANG_THAI, 4);
    KT_BOOL('610 nha cuon dong', k.fb.CUON_DONG, FALSE);
    KT_DINT('bat bien moi chu ky', k.vi, 0);

    KT_DINT('vi tri mo', ViTriVan(CT_MO := TRUE, CT_DONG := FALSE), 1);
    KT_DINT('vi tri dong', ViTriVan(CT_MO := FALSE, CT_DONG := TRUE), 2);
    KT_DINT('vi tri giua', ViTriVan(CT_MO := FALSE, CT_DONG := FALSE), 0);
    KT_DINT('vi tri loi', ViTriVan(CT_MO := TRUE, CT_DONG := TRUE), 3);
    main := KT_TONG();
END_FUNCTION
