FUNCTION_BLOCK ChotLoi
VAR_INPUT
    DUNG_KHAN : BOOL;
    QT1 : BOOL;
    QT2 : BOOL;
    QT3 : BOOL;
    RESET : BOOL;
END_VAR
VAR_OUTPUT
    LOI : BOOL;
    MA_LOI : INT;
END_VAR
VAR
    coNguyenNhan : BOOL;
END_VAR
    coNguyenNhan := DUNG_KHAN OR QT1 OR QT2 OR QT3;
    IF NOT LOI AND coNguyenNhan THEN
        LOI := TRUE;
        IF DUNG_KHAN THEN MA_LOI := 1;
        ELSIF QT1 THEN MA_LOI := 11;
        ELSIF QT2 THEN MA_LOI := 12;
        ELSE MA_LOI := 13;
        END_IF
    ELSIF LOI AND RESET AND NOT coNguyenNhan THEN
        LOI := FALSE;
        MA_LOI := 0;
    END_IF
END_FUNCTION_BLOCK
