FUNCTION_BLOCK GiamSatPhanHoi
VAR_INPUT
    LENH_CHAY : BOOL;
    PHAN_HOI : BOOL;
    T_CHO : TIME;
    RESET : BOOL;
END_VAR
VAR_OUTPUT
    BAO_DONG : BOOL;
    LOI_MAT_PHAN_HOI : BOOL;
    LOI_PHAN_HOI_THUA : BOOL;
END_VAR
VAR
    tonThua : TON;
    daCo : BOOL;      (* đã có phản hồi trong lần chạy hiện tại *)
    dkMat : BOOL;
    dkThua : BOOL;
END_VAR
    dkMat := LENH_CHAY AND daCo AND NOT PHAN_HOI;
    daCo := LENH_CHAY AND (daCo OR PHAN_HOI);
    tonThua(IN := PHAN_HOI AND NOT LENH_CHAY, PT := T_CHO);
    dkThua := tonThua.Q;
    IF dkMat THEN
        LOI_MAT_PHAN_HOI := TRUE;
    ELSIF RESET THEN
        LOI_MAT_PHAN_HOI := FALSE;
    END_IF
    IF dkThua THEN
        LOI_PHAN_HOI_THUA := TRUE;
    ELSIF RESET THEN
        LOI_PHAN_HOI_THUA := FALSE;
    END_IF
    BAO_DONG := LOI_MAT_PHAN_HOI OR LOI_PHAN_HOI_THUA;
END_FUNCTION_BLOCK
