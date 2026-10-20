(* Kịch bản: mỗi lần gọi k chạy n chu kỳ 10 ms; T_SAO 200 ms, T_KHE 50 ms; đếm vi phạm bất biến mọi chu kỳ
   (kể cả: không có chu kỳ nào chuyển thẳng SAO -> TAM_GIAC hay ngược lại mà không qua một chu kỳ cả hai nhả). *)
FUNCTION_BLOCK KtCanhSaoTG
VAR_INPUT
    st, sp, qt, rs : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : KhoiDongSaoTamGiac;
    vi : DINT;
END_VAR
VAR
    i : INT;
    saoTruoc, tgTruoc : BOOL;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        saoTruoc := fb.KM_SAO;
        tgTruoc := fb.KM_TAM_GIAC;
        fb(START := st, STOP := sp, QUA_TAI := qt, RESET := rs, T_SAO := T#200ms, T_KHE := T#50ms);
        IF (fb.KM_SAO AND fb.KM_TAM_GIAC) OR (saoTruoc AND fb.KM_TAM_GIAC) OR (tgTruoc AND fb.KM_SAO)
           OR ((fb.KM_SAO OR fb.KM_TAM_GIAC) AND NOT fb.KM_CHINH)
           OR (fb.LOI_QT AND (fb.KM_CHINH OR fb.KM_SAO OR fb.KM_TAM_GIAC)) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhSaoTG;
    kc : KhoaChuyenMach;
END_VAR
    k(st := FALSE, sp := FALSE, qt := FALSE, rs := FALSE, n := 1);   (* t = 10 *)
    KT_DINT('10 dung', k.fb.TRANG_THAI, 0);
    KT_BOOL('10 KM_CHINH tat', k.fb.KM_CHINH, FALSE);
    k(st := TRUE, n := 1);                     (* t = 20: SAO *)
    KT_DINT('20 sao', k.fb.TRANG_THAI, 1);
    KT_BOOL('20 KM_CHINH', k.fb.KM_CHINH, TRUE);
    KT_BOOL('20 KM_SAO', k.fb.KM_SAO, TRUE);
    KT_BOOL('20 KM_TAM_GIAC tat', k.fb.KM_TAM_GIAC, FALSE);
    k(st := FALSE, n := 19);                   (* t = 30..210 *)
    KT_DINT('210 van sao', k.fb.TRANG_THAI, 1);
    KT_BOOL('210 KM_SAO', k.fb.KM_SAO, TRUE);
    k(n := 1);                                 (* t = 220: 20 + 200 => KHE *)
    KT_DINT('220 khe', k.fb.TRANG_THAI, 2);
    KT_BOOL('220 KM_SAO nha', k.fb.KM_SAO, FALSE);
    KT_BOOL('220 KM_TAM_GIAC chua', k.fb.KM_TAM_GIAC, FALSE);
    KT_BOOL('220 KM_CHINH giu', k.fb.KM_CHINH, TRUE);
    k(n := 4);                                 (* t = 230..260 *)
    KT_DINT('260 van khe', k.fb.TRANG_THAI, 2);
    k(n := 1);                                 (* t = 270: 220 + 50 => TAM_GIAC *)
    KT_DINT('270 tam giac', k.fb.TRANG_THAI, 3);
    KT_BOOL('270 KM_TAM_GIAC', k.fb.KM_TAM_GIAC, TRUE);
    KT_BOOL('270 KM_CHINH', k.fb.KM_CHINH, TRUE);
    k(n := 5);                                 (* t = 280..320 *)
    k(sp := TRUE, n := 1);                     (* t = 330: STOP => cắt hết *)
    KT_DINT('330 dung', k.fb.TRANG_THAI, 0);
    KT_BOOL('330 KM_CHINH tat', k.fb.KM_CHINH, FALSE);
    k(st := TRUE, n := 1);                     (* t = 340: START khi STOP giữ *)
    KT_DINT('340 stop chan start', k.fb.TRANG_THAI, 0);
    k(st := FALSE, sp := FALSE, n := 1);       (* t = 350 *)
    k(st := TRUE, n := 1);                     (* t = 360: SAO *)
    k(st := FALSE, n := 5);                    (* t = 370..410 *)
    k(qt := TRUE, n := 1);                     (* t = 420: quá tải *)
    KT_DINT('420 loi', k.fb.TRANG_THAI, 9);
    KT_BOOL('420 LOI_QT', k.fb.LOI_QT, TRUE);
    KT_BOOL('420 cat het', k.fb.KM_CHINH OR k.fb.KM_SAO OR k.fb.KM_TAM_GIAC, FALSE);
    k(rs := TRUE, n := 1);                     (* t = 430: RESET khi quá tải còn => vẫn lỗi *)
    KT_BOOL('430 reset khi con qua tai', k.fb.LOI_QT, TRUE);
    KT_DINT('430 van loi', k.fb.TRANG_THAI, 9);
    k(qt := FALSE, rs := FALSE, n := 2);       (* t = 440, 450: chốt *)
    KT_BOOL('450 chot', k.fb.LOI_QT, TRUE);
    k(st := TRUE, n := 1);                     (* t = 460: START khi lỗi *)
    KT_DINT('460 start khi loi', k.fb.TRANG_THAI, 9);
    k(st := FALSE, rs := TRUE, n := 1);        (* t = 470: RESET *)
    KT_BOOL('470 reset', k.fb.LOI_QT, FALSE);
    KT_DINT('470 ve dung', k.fb.TRANG_THAI, 0);
    k(rs := FALSE, n := 1);                    (* t = 480 *)
    k(st := TRUE, n := 1);                     (* t = 490: SAO *)
    k(st := FALSE, n := 20);                   (* t = 500..690: 490 + 200 => KHE tại 690 *)
    KT_DINT('690 khe', k.fb.TRANG_THAI, 2);
    k(sp := TRUE, n := 1);                     (* t = 700: STOP trong khe *)
    KT_DINT('700 stop trong khe', k.fb.TRANG_THAI, 0);
    k(sp := FALSE, st := TRUE, n := 1);        (* t = 710: SAO *)
    k(st := FALSE, n := 25);                   (* t = 720..960: KHE 910, TAM_GIAC 960 *)
    KT_DINT('960 tam giac', k.fb.TRANG_THAI, 3);
    k(qt := TRUE, sp := TRUE, n := 1);         (* t = 970: quá tải cùng STOP => LOI *)
    KT_DINT('970 qua tai uu tien', k.fb.TRANG_THAI, 9);
    k(qt := FALSE, sp := FALSE, n := 3);       (* t = 980..1000 *)
    KT_DINT('1000 van loi', k.fb.TRANG_THAI, 9);
    KT_DINT('bat bien moi chu ky', k.vi, 0);

    (* KhoaChuyenMach riêng *)
    kc(YC_SAO := TRUE, YC_TG := FALSE);
    KT_BOOL('khoa sao', kc.KM_SAO, TRUE);
    kc(YC_SAO := FALSE, YC_TG := TRUE);
    KT_BOOL('khoa doi ngay => sao nha', kc.KM_SAO, FALSE);
    KT_BOOL('khoa doi ngay => tg cho', kc.KM_TAM_GIAC, FALSE);
    kc(YC_SAO := FALSE, YC_TG := TRUE);
    KT_BOOL('khoa chu ky sau => tg', kc.KM_TAM_GIAC, TRUE);
    kc(YC_SAO := TRUE, YC_TG := TRUE);
    KT_BOOL('khoa ca hai => sao tat', kc.KM_SAO, FALSE);
    KT_BOOL('khoa ca hai => tg tat', kc.KM_TAM_GIAC, FALSE);
    main := KT_TONG();
END_FUNCTION
