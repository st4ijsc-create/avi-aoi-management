FUNCTION_BLOCK KhoiDongSaoTamGiac
VAR_INPUT
    START : BOOL;
    STOP : BOOL;
    QUA_TAI : BOOL;
    RESET : BOOL;
    T_SAO : TIME;
    T_KHE : TIME;
END_VAR
VAR_OUTPUT
    KM_CHINH : BOOL;
    KM_SAO : BOOL;
    KM_TAM_GIAC : BOOL;
    LOI_QT : BOOL;
    TRANG_THAI : INT;  (* 0 DUNG, 1 SAO, 2 KHE, 3 TAM_GIAC, 9 LOI *)
END_VAR
VAR
    khoa : KhoaChuyenMach;
    rtStart : R_TRIG;
    tBuoc : TON;       (* ET = thời gian đã ở trạng thái hiện tại *)
    ttTruoc : INT;
END_VAR
    (* Quá tải chốt, đặt thắng RESET *)
    LOI_QT := QUA_TAI OR (LOI_QT AND NOT RESET);
    rtStart(CLK := START);
    tBuoc(IN := TRUE, PT := T#24h);

    IF LOI_QT THEN
        TRANG_THAI := 9;
    ELSE
        CASE TRANG_THAI OF
        0: IF rtStart.Q AND NOT STOP THEN TRANG_THAI := 1; END_IF
        1: IF STOP THEN TRANG_THAI := 0; ELSIF tBuoc.ET >= T_SAO THEN TRANG_THAI := 2; END_IF
        2: IF STOP THEN TRANG_THAI := 0; ELSIF tBuoc.ET >= T_KHE THEN TRANG_THAI := 3; END_IF
        3: IF STOP THEN TRANG_THAI := 0; END_IF
        9: TRANG_THAI := 0;
        END_CASE
    END_IF
    IF TRANG_THAI <> ttTruoc THEN
        tBuoc(IN := FALSE);
        tBuoc(IN := TRUE, PT := T#24h);
    END_IF
    ttTruoc := TRANG_THAI;

    khoa(YC_SAO := TRANG_THAI = 1, YC_TG := TRANG_THAI = 3);
    KM_CHINH := TRANG_THAI >= 1 AND TRANG_THAI <= 3;
    KM_SAO := khoa.KM_SAO;
    KM_TAM_GIAC := khoa.KM_TAM_GIAC;
END_FUNCTION_BLOCK
