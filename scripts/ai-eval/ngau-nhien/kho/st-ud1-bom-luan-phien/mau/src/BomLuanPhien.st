FUNCTION_BLOCK BomLuanPhien
VAR_INPUT
    MUC_CAO : BOOL;
    MUC_THAP : BOOL;
    PH1 : BOOL;
    PH2 : BOOL;
    RESET : BOOL;
    T_PHAN_HOI : TIME;
END_VAR
VAR_OUTPUT
    BOM1 : BOOL;
    BOM2 : BOOL;
    CAN_BOM : BOOL;
    LOI1 : BOOL;
    LOI2 : BOOL;
    BAO_DONG : BOOL;
    BOM_CHINH : INT;
END_VAR
VAR
    gs1 : GiamSatBom;
    gs2 : GiamSatBom;
    canCu : BOOL;
    dangChay : INT;  (* 0 = không bơm nào, 1, 2 *)
END_VAR
    (* 1. Nhu cầu bơm: phao thấp thắng; sườn lên của nhu cầu = khởi động mới ⇒ luân phiên *)
    IF MUC_THAP THEN
        CAN_BOM := FALSE;
    ELSIF MUC_CAO THEN
        CAN_BOM := TRUE;
    END_IF
    IF CAN_BOM AND NOT canCu THEN
        IF BOM_CHINH = 1 THEN BOM_CHINH := 2; ELSE BOM_CHINH := 1; END_IF
    END_IF
    canCu := CAN_BOM;

    (* 2. Chọn bơm theo LOI của chu kỳ trước *)
    IF NOT CAN_BOM THEN
        dangChay := 0;
    ELSIF dangChay = 0 OR (dangChay = 1 AND LOI1) OR (dangChay = 2 AND LOI2) THEN
        IF BOM_CHINH = 1 THEN
            IF NOT LOI1 THEN dangChay := 1; ELSIF NOT LOI2 THEN dangChay := 2; ELSE dangChay := 0; END_IF
        ELSE
            IF NOT LOI2 THEN dangChay := 2; ELSIF NOT LOI1 THEN dangChay := 1; ELSE dangChay := 0; END_IF
        END_IF
    END_IF

    (* 3. Giám sát phản hồi *)
    gs1(LENH := dangChay = 1, PHAN_HOI := PH1, RESET := RESET, T_PHAN_HOI := T_PHAN_HOI);
    gs2(LENH := dangChay = 2, PHAN_HOI := PH2, RESET := RESET, T_PHAN_HOI := T_PHAN_HOI);
    LOI1 := gs1.LOI;
    LOI2 := gs2.LOI;

    (* 4. Đầu ra *)
    BOM1 := dangChay = 1 AND NOT LOI1;
    BOM2 := dangChay = 2 AND NOT LOI2;
    BAO_DONG := LOI1 AND LOI2;
END_FUNCTION_BLOCK
