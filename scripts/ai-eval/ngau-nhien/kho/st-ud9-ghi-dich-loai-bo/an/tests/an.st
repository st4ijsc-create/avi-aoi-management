(* Kịch bản băng AOI, chu kỳ 10 ms, VI_TRI_GAT 5, T_GAT 40 ms. Mỗi XUNG encoder = 3 chu kỳ:
   a: ENCODER TRUE (sườn => dịch), b: ENCODER vẫn TRUE (không dịch), c: ENCODER FALSE + kết quả kiểm sản phẩm p.
   Sản phẩm p ghi vào ô 0 ở xung p, tới ô 5 ở chu kỳ a của xung p + 5 => CAN_GAT 4 chu kỳ (a, b, c, a kế tiếp).
   Đếm tổng số chu kỳ CAN_GAT = TRUE trên toàn kịch bản. *)
FUNCTION_BLOCK KtCanhAOI
VAR_INPUT
    enc, sp, loi, rs : BOOL;
    viTri : INT;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : LoaiBoAOI;
    soGat : DINT;
END_VAR
VAR
    i : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        fb(ENCODER := enc, CO_SAN_PHAM := sp, LOI_AOI := loi, RESET := rs, VI_TRI_GAT := viTri, T_GAT := T#40ms);
        IF fb.CAN_GAT THEN soGat := soGat + 1; END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhAOI;
    tg : ThanhGhiDich;
    p : INT;
    (* sản phẩm 1..20: có sản phẩm / kết quả lỗi; p2, p3, p10 lỗi; p5 báo lỗi nhưng KHÔNG có sản phẩm *)
    spA : ARRAY[1..20] OF BOOL := [TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, TRUE,
                                   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE];
    loiA : ARRAY[1..20] OF BOOL := [FALSE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE,
                                    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE];
END_VAR
    k(enc := FALSE, sp := FALSE, loi := FALSE, rs := FALSE, viTri := 5, n := 1);
    FOR p := 1 TO 3 DO
        k(enc := TRUE, sp := FALSE, loi := FALSE, n := 2);
        k(enc := FALSE, sp := spA[p], loi := loiA[p], n := 1);
    END_FOR
    KT_DINT('sau xung 3: 2 o loi', k.fb.SO_O_LOI, 2);
    FOR p := 4 TO 6 DO
        k(enc := TRUE, sp := FALSE, loi := FALSE, n := 2);
        k(enc := FALSE, sp := spA[p], loi := loiA[p], n := 1);
    END_FOR
    KT_DINT('sau xung 6: chua gat', k.fb.DEM_GAT, 0);
    KT_BOOL('sau xung 6: CAN_GAT tat', k.fb.CAN_GAT, FALSE);
    KT_DINT('p5 khong co san pham => khong ghi', k.fb.SO_O_LOI, 2);
    (* xung 7: p2 tới ô 5 ở chu kỳ a *)
    k(enc := TRUE, sp := FALSE, loi := FALSE, n := 1);
    KT_BOOL('xung 7a gat', k.fb.CAN_GAT, TRUE);
    KT_DINT('xung 7a dem 1', k.fb.DEM_GAT, 1);
    k(enc := TRUE, n := 1);
    k(enc := FALSE, sp := spA[7], loi := loiA[7], n := 1);
    (* xung 8: p3 tới khi xung gạt còn bật (chu kỳ thứ 4) => đếm nhưng không kéo dài *)
    k(enc := TRUE, sp := FALSE, loi := FALSE, n := 1);
    KT_BOOL('xung 8a van gat (40ms chua het)', k.fb.CAN_GAT, TRUE);
    KT_DINT('xung 8a dem 2', k.fb.DEM_GAT, 2);
    k(enc := TRUE, n := 1);
    KT_BOOL('xung 8b het gat', k.fb.CAN_GAT, FALSE);
    k(enc := FALSE, sp := spA[8], loi := loiA[8], n := 1);
    FOR p := 9 TO 14 DO
        k(enc := TRUE, sp := FALSE, loi := FALSE, n := 2);
        k(enc := FALSE, sp := spA[p], loi := loiA[p], n := 1);
    END_FOR
    KT_DINT('sau xung 14 dem 2', k.fb.DEM_GAT, 2);
    KT_BOOL('sau xung 14 khong gat', k.fb.CAN_GAT, FALSE);
    (* xung 15: p10 tới *)
    k(enc := TRUE, sp := FALSE, loi := FALSE, n := 1);
    KT_BOOL('xung 15a gat', k.fb.CAN_GAT, TRUE);
    KT_DINT('xung 15a dem 3', k.fb.DEM_GAT, 3);
    k(enc := TRUE, n := 1);
    k(enc := FALSE, sp := spA[15], loi := loiA[15], n := 1);
    FOR p := 16 TO 20 DO
        k(enc := TRUE, sp := FALSE, loi := FALSE, n := 2);
        k(enc := FALSE, sp := spA[p], loi := loiA[p], n := 1);
    END_FOR
    KT_DINT('tong chu ky gat = 8', k.soGat, 8);
    KT_DINT('dem 3', k.fb.DEM_GAT, 3);
    KT_DINT('3 o loi con trong thanh ghi', k.fb.SO_O_LOI, 3);

    (* RESET *)
    k(enc := FALSE, sp := FALSE, loi := FALSE, rs := TRUE, n := 1);
    KT_DINT('reset xoa thanh ghi', k.fb.SO_O_LOI, 0);
    KT_DINT('reset dem 0', k.fb.DEM_GAT, 0);
    k(rs := FALSE, n := 1);
    (* sản phẩm lỗi báo ĐÚNG chu kỳ có sườn encoder: dịch trước rồi ghi => nằm ở ô 0 *)
    k(enc := TRUE, sp := TRUE, loi := TRUE, n := 1);
    k(enc := TRUE, sp := FALSE, loi := FALSE, n := 1);
    k(enc := FALSE, n := 1);
    FOR p := 1 TO 4 DO
        k(enc := TRUE, n := 2);
        k(enc := FALSE, n := 1);
    END_FOR
    KT_DINT('sau 4 xung chua toi', k.fb.DEM_GAT, 0);
    k(enc := TRUE, n := 1);
    KT_BOOL('xung thu 5 gat', k.fb.CAN_GAT, TRUE);
    KT_DINT('xung thu 5 dem 1', k.fb.DEM_GAT, 1);
    k(enc := TRUE, n := 1);
    k(enc := FALSE, n := 1);
    FOR p := 1 TO 30 DO
        k(enc := TRUE, n := 2);
        k(enc := FALSE, n := 1);
    END_FOR
    KT_DINT('qua o 32 thi roi khoi thanh ghi', k.fb.SO_O_LOI, 0);
    KT_DINT('tong chu ky gat = 12', k.soGat, 12);
    (* vị trí gạt ngoài 1..32 => không bao giờ gạt *)
    k(viTri := 33, enc := FALSE, sp := TRUE, loi := TRUE, n := 1);
    FOR p := 1 TO 40 DO
        k(enc := TRUE, sp := FALSE, loi := FALSE, n := 2);
        k(enc := FALSE, n := 1);
    END_FOR
    KT_DINT('vi tri 33 khong gat', k.soGat, 12);
    KT_DINT('vi tri 33 dem giu 1', k.fb.DEM_GAT, 1);

    (* ThanhGhiDich riêng *)
    tg(DICH := FALSE, GHI := TRUE, XOA := FALSE, VI_TRI := 0);
    KT_BOOL('tg ghi o 0', tg.Q, TRUE);
    tg(DICH := TRUE, GHI := FALSE, VI_TRI := 1);
    KT_BOOL('tg dich sang o 1', tg.Q, TRUE);
    tg(DICH := FALSE, VI_TRI := 0);
    KT_BOOL('tg o 0 trong', tg.Q, FALSE);
    tg(VI_TRI := -1);
    KT_BOOL('tg vi tri am => FALSE', tg.Q, FALSE);
    main := KT_TONG();
END_FUNCTION
