FUNCTION_BLOCK DemGioChay
VAR_INPUT
    DANG_CHAY : BOOL;
    RESET : BOOL;
END_VAR
VAR_OUTPUT
    GIO : UDINT;
    PHUT : UDINT;
    GIAY_TONG : UDINT;
END_VAR
VAR
    batDau : R_TRIG;
    tCu : TIME;      (* G_NOW của chu kỳ trước *)
    le : TIME;       (* phần lẻ dưới 1 s chưa cộng vào GIAY_TONG *)
END_VAR
    batDau(CLK := DANG_CHAY);
    IF RESET THEN
        GIAY_TONG := 0;
        le := T#0s;
    ELSIF DANG_CHAY AND NOT batDau.Q THEN
        le := le + (G_NOW - tCu);
        WHILE le >= T#1s DO
            le := le - T#1s;
            GIAY_TONG := GIAY_TONG + 1;
        END_WHILE
    END_IF
    tCu := G_NOW;
    GIO := GIAY_TONG / 3600;
    PHUT := (GIAY_TONG / 60) MOD 60;
END_FUNCTION_BLOCK
