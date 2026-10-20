FUNCTION_BLOCK LoaiBoAOI
VAR_INPUT
    ENCODER : BOOL;
    CO_SAN_PHAM : BOOL;
    LOI_AOI : BOOL;
    RESET : BOOL;
    VI_TRI_GAT : INT;
    T_GAT : TIME;
END_VAR
VAR_OUTPUT
    CAN_GAT : BOOL;
    DEM_GAT : DINT;
    SO_O_LOI : INT;
END_VAR
VAR
    rtEnc : R_TRIG;
    tg : ThanhGhiDich;
    xungGat : TP;
    toi : BOOL;
END_VAR
    rtEnc(CLK := ENCODER);
    tg(DICH := rtEnc.Q AND NOT RESET, GHI := CO_SAN_PHAM AND LOI_AOI AND NOT RESET, XOA := RESET, VI_TRI := VI_TRI_GAT);
    (* sản phẩm lỗi vừa được dịch tới vị trí gạt *)
    toi := rtEnc.Q AND NOT RESET AND VI_TRI_GAT >= 1 AND VI_TRI_GAT <= 32 AND tg.Q;
    IF RESET THEN
        DEM_GAT := 0;
    ELSIF toi THEN
        DEM_GAT := DEM_GAT + 1;
    END_IF
    xungGat(IN := toi, PT := T_GAT);
    CAN_GAT := xungGat.Q;
    SO_O_LOI := tg.SO_O;
END_FUNCTION_BLOCK
