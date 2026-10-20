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
    TRANG_THAI : INT;
    LOI : BOOL;
    MA_LOI : INT;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    B1 := FALSE;
END_FUNCTION_BLOCK
