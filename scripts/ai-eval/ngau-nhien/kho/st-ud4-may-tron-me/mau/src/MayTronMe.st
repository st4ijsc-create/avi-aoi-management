FUNCTION_BLOCK MayTronMe
VAR_INPUT
    START : BOOL;
    STOP : BOOL;
    MUC : REAL;
    MUC_A : REAL;
    MUC_B : REAL;
    MUC_RONG : REAL;
    T_TRON : TIME;
END_VAR
VAR_OUTPUT
    VAN_A : BOOL;
    VAN_B : BOOL;
    VAN_XA : BOOL;
    MOTOR : BOOL;
    TRANG_THAI : INT;  (* 0 CHO, 1 CAP_A, 2 CAP_B, 3 TRON, 4 XA, 5 XONG, 6 TAM_DUNG *)
    SO_ME : DINT;
END_VAR
VAR
    khoa : KhoaLienDongVan;
    rtStart : R_TRIG;
    tBuoc : TON;       (* ET = thời gian đã ở trạng thái hiện tại *)
    ttTruoc : INT;
    buocDo : INT;      (* bước đang dở khi tạm dừng *)
END_VAR
    rtStart(CLK := START);
    tBuoc(IN := TRUE, PT := T#24h);

    CASE TRANG_THAI OF
    0:
        IF rtStart.Q AND NOT STOP THEN TRANG_THAI := 1; END_IF
    1, 2, 3, 4:
        IF STOP THEN
            buocDo := TRANG_THAI;
            TRANG_THAI := 6;
        ELSIF TRANG_THAI = 1 THEN
            IF MUC >= MUC_A THEN TRANG_THAI := 2; END_IF
        ELSIF TRANG_THAI = 2 THEN
            IF MUC >= MUC_A + MUC_B THEN TRANG_THAI := 3; END_IF
        ELSIF TRANG_THAI = 3 THEN
            IF tBuoc.ET >= T_TRON THEN TRANG_THAI := 4; END_IF
        ELSE
            IF MUC <= MUC_RONG THEN
                TRANG_THAI := 5;
                SO_ME := SO_ME + 1;
            END_IF
        END_IF
    5:
        TRANG_THAI := 0;
    6:
        IF rtStart.Q AND NOT STOP THEN TRANG_THAI := buocDo; END_IF
    END_CASE
    IF TRANG_THAI <> ttTruoc THEN
        tBuoc(IN := FALSE);
        tBuoc(IN := TRUE, PT := T#24h);
    END_IF
    ttTruoc := TRANG_THAI;

    khoa(YC_A := TRANG_THAI = 1, YC_B := TRANG_THAI = 2, YC_XA := TRANG_THAI = 4);
    VAN_A := khoa.VAN_A;
    VAN_B := khoa.VAN_B;
    VAN_XA := khoa.VAN_XA;
    MOTOR := TRANG_THAI = 3;
END_FUNCTION_BLOCK
