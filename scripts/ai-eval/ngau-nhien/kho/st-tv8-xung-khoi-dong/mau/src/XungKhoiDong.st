FUNCTION_BLOCK XungKhoiDong
VAR_INPUT
    NUT : BOOL;
    T_XUNG : TIME;
    KHOA : BOOL;
END_VAR
VAR_OUTPUT
    XUNG : BOOL;
    SO_LAN : UDINT;
END_VAR
VAR
    suon : R_TRIG;
    xungTp : TP;
    xungCu : BOOL;
END_VAR
    suon(CLK := NUT);
    IF KHOA THEN
        (* cắt xung: PT = 0 làm TP kết thúc ngay, sẵn sàng cho sườn sau *)
        xungTp(IN := FALSE, PT := T#0s);
    ELSE
        xungTp(IN := suon.Q, PT := T_XUNG);
        IF xungTp.Q AND NOT xungCu THEN
            SO_LAN := SO_LAN + 1;
        END_IF
    END_IF
    XUNG := xungTp.Q;
    xungCu := XUNG;
END_FUNCTION_BLOCK
