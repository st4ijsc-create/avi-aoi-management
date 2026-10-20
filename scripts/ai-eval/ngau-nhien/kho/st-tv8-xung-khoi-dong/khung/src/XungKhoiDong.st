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
    (* TODO: cài đặt theo đề bài, dùng TP + R_TRIG *)
    XUNG := FALSE;
END_FUNCTION_BLOCK
