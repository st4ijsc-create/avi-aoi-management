FUNCTION main : DINT
VAR
    fb : LoaiBoAOI;
    i : INT;
END_VAR
    (* sản phẩm lỗi ở ô 0, sau 2 xung encoder (mỗi xung TRUE một chu kỳ) tới ô 2 = vị trí gạt *)
    fb(CO_SAN_PHAM := TRUE, LOI_AOI := TRUE, VI_TRI_GAT := 2, T_GAT := T#40ms);
    KT_DINT('ghi o 0', fb.SO_O_LOI, 1);
    FOR i := 1 TO 2 DO
        KT_BUOC(T#10ms);
        fb(ENCODER := TRUE, CO_SAN_PHAM := FALSE, LOI_AOI := FALSE);
        KT_BUOC(T#10ms);
        fb(ENCODER := FALSE);
    END_FOR
    KT_BOOL('toi vi tri => gat', fb.CAN_GAT, TRUE);
    KT_DINT('dem 1', fb.DEM_GAT, 1);
    main := KT_TONG();
END_FUNCTION
