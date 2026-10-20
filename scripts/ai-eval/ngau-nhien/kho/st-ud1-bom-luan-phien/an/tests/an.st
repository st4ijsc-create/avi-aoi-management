(* Kịch bản: mỗi lần gọi k chạy n chu kỳ 10 ms; phản hồi bơm = lệnh của chu kỳ TRƯỚC AND bơm khoẻ;
   đếm vi phạm bất biến ở MỌI chu kỳ. Mốc tính tay từ đề (T_PHAN_HOI = 50 ms). *)
FUNCTION_BLOCK KtCanhBom
VAR_INPUT
    cao, thap, khoe1, khoe2, rs : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : BomLuanPhien;
    vi : DINT;
END_VAR
VAR
    i : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        fb(MUC_CAO := cao, MUC_THAP := thap, PH1 := fb.BOM1 AND khoe1, PH2 := fb.BOM2 AND khoe2,
           RESET := rs, T_PHAN_HOI := T#50ms);
        IF (fb.BOM1 AND fb.BOM2) OR (fb.BOM1 AND fb.LOI1) OR (fb.BOM2 AND fb.LOI2)
           OR ((fb.BOM1 OR fb.BOM2) AND NOT fb.CAN_BOM) OR (fb.BAO_DONG <> (fb.LOI1 AND fb.LOI2)) THEN
            vi := vi + 1;
        END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhBom;
END_VAR
    (* t = 10, 20: mức thấp, chưa khởi động lần nào *)
    k(cao := FALSE, thap := TRUE, khoe1 := TRUE, khoe2 := TRUE, rs := FALSE, n := 2);
    KT_BOOL('nghi BOM1', k.fb.BOM1, FALSE);
    KT_BOOL('nghi BOM2', k.fb.BOM2, FALSE);
    KT_DINT('chua khoi dong BOM_CHINH 0', k.fb.BOM_CHINH, 0);
    (* t = 30: khởi động 1 => bơm 1 *)
    k(cao := TRUE, thap := FALSE, n := 1);
    KT_BOOL('kd1 CAN_BOM', k.fb.CAN_BOM, TRUE);
    KT_BOOL('kd1 BOM1', k.fb.BOM1, TRUE);
    KT_BOOL('kd1 BOM2 tat', k.fb.BOM2, FALSE);
    KT_DINT('kd1 BOM_CHINH 1', k.fb.BOM_CHINH, 1);
    (* t = 40..130: phao cao nhả, chưa tới phao thấp => giữ chạy *)
    k(cao := FALSE, thap := FALSE, n := 10);
    KT_BOOL('giu chay BOM1', k.fb.BOM1, TRUE);
    KT_BOOL('co phan hoi khong loi', k.fb.LOI1, FALSE);
    (* t = 140: phao thấp => tắt ngay *)
    k(thap := TRUE, n := 1);
    KT_BOOL('phao thap CAN_BOM', k.fb.CAN_BOM, FALSE);
    KT_BOOL('phao thap BOM1', k.fb.BOM1, FALSE);
    (* t = 150: khởi động 2 => bơm 2 *)
    k(cao := TRUE, thap := FALSE, n := 1);
    KT_BOOL('kd2 BOM2', k.fb.BOM2, TRUE);
    KT_BOOL('kd2 BOM1 tat', k.fb.BOM1, FALSE);
    KT_DINT('kd2 BOM_CHINH 2', k.fb.BOM_CHINH, 2);
    k(cao := FALSE, n := 5);           (* t = 160..200 *)
    k(thap := TRUE, n := 2);           (* t = 210, 220 *)
    (* t = 230: khởi động 3 => bơm 1, nhưng bơm 1 hỏng (không phản hồi). TON bắt đầu t = 230. *)
    k(cao := TRUE, thap := FALSE, khoe1 := FALSE, n := 1);
    k(cao := FALSE, n := 4);           (* t = 240..270: mới 40 ms *)
    KT_BOOL('270 BOM1 van chay', k.fb.BOM1, TRUE);
    KT_BOOL('270 chua loi', k.fb.LOI1, FALSE);
    k(n := 1);                         (* t = 280: đủ 50 ms => LOI1, bơm 1 tắt ngay; bơm 2 từ chu kỳ sau *)
    KT_BOOL('280 LOI1', k.fb.LOI1, TRUE);
    KT_BOOL('280 BOM1 tat', k.fb.BOM1, FALSE);
    KT_BOOL('280 BOM2 chua bat', k.fb.BOM2, FALSE);
    k(n := 1);                         (* t = 290 *)
    KT_BOOL('290 chuyen BOM2', k.fb.BOM2, TRUE);
    KT_DINT('290 BOM_CHINH van 1', k.fb.BOM_CHINH, 1);
    k(n := 10);                        (* t = 300..390 *)
    k(thap := TRUE, n := 1);           (* t = 400 *)
    KT_BOOL('LOI1 chot qua lan dung', k.fb.LOI1, TRUE);
    (* t = 410: khởi động 4 => bơm 2 *)
    k(cao := TRUE, thap := FALSE, n := 1);
    KT_BOOL('kd4 BOM2', k.fb.BOM2, TRUE);
    KT_DINT('kd4 BOM_CHINH 2', k.fb.BOM_CHINH, 2);
    k(cao := FALSE, thap := TRUE, n := 1);   (* t = 420 *)
    (* t = 430: khởi động 5 => chỉ định bơm 1 nhưng bơm 1 đang lỗi => bơm 2 ngay *)
    k(cao := TRUE, thap := FALSE, n := 1);
    KT_BOOL('kd5 BOM2 ngay', k.fb.BOM2, TRUE);
    KT_BOOL('kd5 BOM1 tat', k.fb.BOM1, FALSE);
    k(cao := FALSE, n := 3);           (* t = 440..460: bơm 2 có phản hồi từ t = 440 *)
    (* t = 470: bơm 2 hỏng; phản hồi mất từ t = 470 => LOI2 tại t = 520 *)
    k(khoe2 := FALSE, n := 1);
    k(n := 4);                         (* t = 480..510 *)
    KT_BOOL('510 chua bao dong', k.fb.BAO_DONG, FALSE);
    KT_BOOL('510 BOM2 van chay', k.fb.BOM2, TRUE);
    k(n := 1);                         (* t = 520 *)
    KT_BOOL('520 LOI2', k.fb.LOI2, TRUE);
    KT_BOOL('520 BAO_DONG', k.fb.BAO_DONG, TRUE);
    KT_BOOL('520 BOM2 tat', k.fb.BOM2, FALSE);
    KT_BOOL('520 BOM1 tat', k.fb.BOM1, FALSE);
    k(n := 3);                         (* t = 530..550 *)
    (* t = 560: RESET (hai bơm đã sửa), nhu cầu vẫn còn. Chọn bơm dùng LOI chu kỳ trước => chưa bơm. *)
    k(khoe1 := TRUE, khoe2 := TRUE, rs := TRUE, n := 1);
    KT_BOOL('reset LOI1', k.fb.LOI1, FALSE);
    KT_BOOL('reset LOI2', k.fb.LOI2, FALSE);
    KT_BOOL('reset BAO_DONG', k.fb.BAO_DONG, FALSE);
    KT_BOOL('reset chua bom', k.fb.BOM1 OR k.fb.BOM2, FALSE);
    k(rs := FALSE, n := 1);            (* t = 570: bơm chỉ định của lần 5 là bơm 1 *)
    KT_BOOL('sau reset BOM1', k.fb.BOM1, TRUE);
    (* t = 580: cả hai phao TRUE => phao thấp thắng *)
    k(cao := TRUE, thap := TRUE, n := 1);
    KT_BOOL('hai phao CAN_BOM', k.fb.CAN_BOM, FALSE);
    KT_BOOL('hai phao BOM1', k.fb.BOM1, FALSE);
    KT_DINT('bat bien moi chu ky', k.vi, 0);
    main := KT_TONG();
END_FUNCTION
