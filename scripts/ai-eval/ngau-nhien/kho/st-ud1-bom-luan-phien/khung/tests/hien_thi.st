FUNCTION main : DINT
VAR
    fb : BomLuanPhien;
END_VAR
    fb(MUC_CAO := TRUE, MUC_THAP := FALSE, T_PHAN_HOI := T#50ms);
    KT_BOOL('khoi dong dau => BOM1', fb.BOM1, TRUE);
    KT_BOOL('khoi dong dau => BOM2 tat', fb.BOM2, FALSE);
    KT_DINT('khoi dong dau => BOM_CHINH 1', fb.BOM_CHINH, 1);
    main := KT_TONG();
END_FUNCTION
