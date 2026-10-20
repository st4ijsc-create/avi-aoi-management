FUNCTION_BLOCK BangTaiTuanTu
VAR_INPUT
    START : BOOL;
    STOP : BOOL;
    DUNG_KHAN : BOOL;
    QT1 : BOOL;
    QT2 : BOOL;
    QT3 : BOOL;
    RESET : BOOL;
    T_TRE : TIME;
END_VAR
VAR_OUTPUT
    B1 : BOOL;
    B2 : BOOL;
    B3 : BOOL;
    TRANG_THAI : INT;  (* 0 DUNG, 1 KD_B3, 2 KD_B2, 3 CHAY, 4 DUNG_B1, 5 DUNG_B2, 9 LOI *)
    LOI : BOOL;
    MA_LOI : INT;
END_VAR
VAR
    chot : ChotLoi;
    rtStart : R_TRIG;
    tBuoc : TON;       (* ET = thời gian đã ở trạng thái hiện tại *)
    ttTruoc : INT;
END_VAR
    chot(DUNG_KHAN := DUNG_KHAN, QT1 := QT1, QT2 := QT2, QT3 := QT3, RESET := RESET);
    LOI := chot.LOI;
    MA_LOI := chot.MA_LOI;
    rtStart(CLK := START);
    tBuoc(IN := TRUE, PT := T#24h);

    IF LOI THEN
        TRANG_THAI := 9;
    ELSE
        CASE TRANG_THAI OF
        0: IF rtStart.Q AND NOT STOP THEN TRANG_THAI := 1; END_IF
        1: IF STOP THEN TRANG_THAI := 5; ELSIF tBuoc.ET >= T_TRE THEN TRANG_THAI := 2; END_IF
        2: IF STOP THEN TRANG_THAI := 4; ELSIF tBuoc.ET >= T_TRE THEN TRANG_THAI := 3; END_IF
        3: IF STOP THEN TRANG_THAI := 4; END_IF
        4: IF tBuoc.ET >= T_TRE THEN TRANG_THAI := 5; END_IF
        5: IF tBuoc.ET >= T_TRE THEN TRANG_THAI := 0; END_IF
        9: TRANG_THAI := 0;
        END_CASE
    END_IF
    IF TRANG_THAI <> ttTruoc THEN
        tBuoc(IN := FALSE);
        tBuoc(IN := TRUE, PT := T#24h);
    END_IF
    ttTruoc := TRANG_THAI;

    B3 := TRANG_THAI >= 1 AND TRANG_THAI <= 5;
    B2 := TRANG_THAI >= 2 AND TRANG_THAI <= 4;
    B1 := TRANG_THAI = 3;
END_FUNCTION_BLOCK
