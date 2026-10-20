(* Kịch bản lò: SP 100, TRE 5 (bật khi <= 95, tắt khi >= 105), NGUONG_CAO 110, NGUONG_HH 120.
   Chế độ mô phỏng (ep = FALSE): trước mỗi lần gọi nhiệt += 2.0 nếu chu kỳ trước SUOI, ngược lại -= 1.0.
   Chế độ ép (ep = TRUE): nhiệt := gia. Đếm sườn lên SUOI, max/min, vi phạm bất biến mọi chu kỳ.
   Lần gọi thứ k (k = 0, 1, ...) của mô phỏng: nhiệt_0 = 20; tính tay:
   k = 0..42 sưởi (20..104), k = 43 nhiệt 106 => tắt, k = 54 nhiệt 95 => bật, k = 59 nhiệt 105 => tắt,
   k = 69 95 bật, k = 84 bật, k = 99 bật => 5 sườn lên trong k = 0..99. *)
FUNCTION_BLOCK KtCanhLo
VAR_INPUT
    bat, ep, rs, xoaMin : BOOL;
    gia : REAL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : DieuKhienNhietLo;
    vi : DINT;
    nhiet : REAL := 21.0;
    soBat : DINT;
    lonNhat : REAL := -1000.0;
    nhoNhat : REAL := 1000.0;
END_VAR
VAR
    i : INT;
    suoiTruoc : BOOL;
END_VAR
    IF xoaMin THEN nhoNhat := 1000.0; END_IF
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        suoiTruoc := fb.SUOI;
        IF ep THEN
            nhiet := gia;
        ELSIF fb.SUOI THEN
            nhiet := nhiet + 2.0;
        ELSE
            nhiet := nhiet - 1.0;
        END_IF
        fb(BAT := bat, NHIET := nhiet, SP := 100.0, TRE := 5.0, NGUONG_CAO := 110.0, NGUONG_HH := 120.0, RESET := rs);
        IF fb.SUOI AND NOT suoiTruoc THEN soBat := soBat + 1; END_IF
        IF nhiet > lonNhat THEN lonNhat := nhiet; END_IF
        IF nhiet < nhoNhat THEN nhoNhat := nhiet; END_IF
        IF fb.SUOI AND (fb.NGAT_HH OR fb.LOI_CAM_BIEN OR NOT bat) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhLo;
END_VAR
    k(bat := TRUE, ep := FALSE, rs := FALSE, xoaMin := FALSE, gia := 0.0, n := 43);    (* k = 0..42 *)
    KT_BOOL('k42 suoi', k.fb.SUOI, TRUE);
    KT_REAL('k42 nhiet 104', k.nhiet, 104.0, 0.001);
    k(n := 1);                                                       (* k = 43 *)
    KT_BOOL('k43 >= 105 tat', k.fb.SUOI, FALSE);
    KT_REAL('k43 nhiet 106', k.nhiet, 106.0, 0.001);
    k(xoaMin := TRUE, n := 10);                                                      (* k = 44..53 *)
    KT_BOOL('k53 96 van tat', k.fb.SUOI, FALSE);
    KT_REAL('k53 nhiet 96', k.nhiet, 96.0, 0.001);
    k(xoaMin := FALSE, n := 1);                                      (* k = 54: đúng 95 *)
    KT_BOOL('k54 dung 95 => bat', k.fb.SUOI, TRUE);
    k(n := 45);                                                      (* k = 55..99 *)
    KT_DINT('5 lan bat trong 100 chu ky', k.soBat, 5);
    KT_REAL('nhiet lon nhat 106', k.lonNhat, 106.0, 0.001);
    KT_REAL('nhiet nho nhat sau k43 = 95', k.nhoNhat, 95.0, 0.001);
    KT_DINT('dieu khien', k.fb.TRANG_THAI, 1);
    KT_BOOL('khong canh bao khi dao dong', k.fb.CANH_BAO_CAO, FALSE);

    (* Ép nhiệt *)
    k(ep := TRUE, gia := 115.0, n := 1);
    KT_BOOL('115 canh bao', k.fb.CANH_BAO_CAO, TRUE);
    KT_BOOL('115 suoi tat', k.fb.SUOI, FALSE);
    KT_BOOL('115 chua ngat', k.fb.NGAT_HH, FALSE);
    k(gia := 108.0, n := 1);
    KT_BOOL('108 het canh bao (khong chot)', k.fb.CANH_BAO_CAO, FALSE);
    k(gia := 110.0, n := 1);
    KT_BOOL('110 dung nguong canh bao', k.fb.CANH_BAO_CAO, TRUE);
    k(gia := 120.0, n := 1);
    KT_BOOL('120 dung nguong ngat', k.fb.NGAT_HH, TRUE);
    KT_DINT('120 trang thai ngat', k.fb.TRANG_THAI, 2);
    k(gia := 90.0, n := 1);
    KT_BOOL('90 ngat van chot', k.fb.NGAT_HH, TRUE);
    KT_BOOL('90 suoi tat do ngat', k.fb.SUOI, FALSE);
    k(gia := 102.0, rs := TRUE, n := 1);
    KT_BOOL('reset khi 102 >= SP => van ngat', k.fb.NGAT_HH, TRUE);
    k(gia := 100.0, n := 1);
    KT_BOOL('reset khi 100 = SP => van ngat', k.fb.NGAT_HH, TRUE);
    k(gia := 99.0, n := 1);
    KT_BOOL('reset khi 99 < SP => het ngat', k.fb.NGAT_HH, FALSE);
    KT_BOOL('99 suoi (tre dang bat tu 90)', k.fb.SUOI, TRUE);
    KT_DINT('99 dieu khien', k.fb.TRANG_THAI, 1);
    k(rs := FALSE, bat := FALSE, n := 1);
    KT_BOOL('BAT tat => suoi tat', k.fb.SUOI, FALSE);
    KT_DINT('BAT tat => trang thai 0', k.fb.TRANG_THAI, 0);
    k(bat := TRUE, gia := 600.0, n := 1);
    KT_BOOL('600 loi cam bien', k.fb.LOI_CAM_BIEN, TRUE);
    KT_BOOL('600 suoi tat', k.fb.SUOI, FALSE);
    KT_BOOL('600 khong canh bao', k.fb.CANH_BAO_CAO, FALSE);
    KT_BOOL('600 khong ngat', k.fb.NGAT_HH, FALSE);
    KT_DINT('600 trang thai 3', k.fb.TRANG_THAI, 3);
    k(gia := -60.0, rs := TRUE, n := 1);
    KT_BOOL('-60 loi cam bien', k.fb.LOI_CAM_BIEN, TRUE);
    k(gia := -50.0, rs := FALSE, n := 1);
    KT_BOOL('-50 hop le', k.fb.LOI_CAM_BIEN, FALSE);
    k(gia := 500.0, n := 1);
    KT_BOOL('500 hop le', k.fb.LOI_CAM_BIEN, FALSE);
    KT_BOOL('500 ngat HH', k.fb.NGAT_HH, TRUE);
    k(gia := 501.0, n := 1);
    KT_BOOL('501 loi cam bien', k.fb.LOI_CAM_BIEN, TRUE);
    KT_DINT('501 loi uu tien hon ngat', k.fb.TRANG_THAI, 3);
    KT_DINT('bat bien moi chu ky', k.vi, 0);
    main := KT_TONG();
END_FUNCTION
