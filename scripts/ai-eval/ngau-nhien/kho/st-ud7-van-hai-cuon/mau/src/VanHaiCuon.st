FUNCTION_BLOCK VanHaiCuon
VAR_INPUT
    MO : BOOL;
    DONG : BOOL;
    CT_MO : BOOL;
    CT_DONG : BOOL;
    RESET : BOOL;
    T_HANH_TRINH : TIME;
END_VAR
VAR_OUTPUT
    CUON_MO : BOOL;
    CUON_DONG : BOOL;
    TRANG_THAI : INT;  (* 1 DANG_MO, 2 DANG_DONG, 3 DA_MO, 4 DA_DONG, 5 GIUA_CHUNG, 9 LOI *)
    MA_LOI : INT;      (* 0, 1 hành trình, 2 công tắc *)
END_VAR
VAR
    rtMo : R_TRIG;
    rtDong : R_TRIG;
    tBuoc : TON;       (* ET = thời gian đã ở bước hiện tại *)
    tt : INT;          (* 0 NGHI, 1 CHAY_MO, 2 CHAY_DONG, 3 DAO_MO, 4 DAO_DONG, 9 LOI *)
    ttTruoc : INT;
    vt : INT;
    eMo : BOOL;
    eDong : BOOL;
END_VAR
    vt := ViTriVan(CT_MO := CT_MO, CT_DONG := CT_DONG);
    rtMo(CLK := MO);
    rtDong(CLK := DONG);
    eMo := rtMo.Q AND NOT rtDong.Q;
    eDong := rtDong.Q AND NOT rtMo.Q;
    tBuoc(IN := TRUE, PT := T#24h);

    IF vt = 3 THEN
        IF tt <> 9 THEN MA_LOI := 2; END_IF
        tt := 9;
    ELSE
        CASE tt OF
        0:
            IF eMo AND vt <> 1 THEN tt := 1;
            ELSIF eDong AND vt <> 2 THEN tt := 2;
            END_IF
        1:
            IF vt = 1 THEN tt := 0;
            ELSIF eDong THEN tt := 4;
            ELSIF tBuoc.ET >= T_HANH_TRINH THEN tt := 9; MA_LOI := 1;
            END_IF
        2:
            IF vt = 2 THEN tt := 0;
            ELSIF eMo THEN tt := 3;
            ELSIF tBuoc.ET >= T_HANH_TRINH THEN tt := 9; MA_LOI := 1;
            END_IF
        3: tt := 1;
        4: tt := 2;
        9:
            IF RESET THEN tt := 0; MA_LOI := 0; END_IF
        END_CASE
    END_IF
    IF tt <> ttTruoc THEN
        tBuoc(IN := FALSE);
        tBuoc(IN := TRUE, PT := T#24h);
    END_IF
    ttTruoc := tt;

    CUON_MO := tt = 1;
    CUON_DONG := tt = 2;
    CASE tt OF
    1, 3: TRANG_THAI := 1;
    2, 4: TRANG_THAI := 2;
    9: TRANG_THAI := 9;
    ELSE
        IF vt = 1 THEN TRANG_THAI := 3;
        ELSIF vt = 2 THEN TRANG_THAI := 4;
        ELSE TRANG_THAI := 5;
        END_IF
    END_CASE
END_FUNCTION_BLOCK
