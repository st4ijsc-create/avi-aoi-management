// tệp: src/ChotLoi.st
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
    CoNguyenNhan : BOOL;
END_VAR

    CoNguyenNhan := DUNG_KHAN OR QT1 OR QT2 OR QT3;

    IF NOT LOI AND CoNguyenNhan THEN
        LOI := TRUE;
        IF DUNG_KHAN THEN
            MA_LOI := 1;
        ELSIF QT1 THEN
            MA_LOI := 11;
        ELSIF QT2 THEN
            MA_LOI := 12;
        ELSE
            MA_LOI := 13;
        END_IF
    ELSIF LOI THEN
        IF RESET AND NOT CoNguyenNhan THEN
            LOI := FALSE;
            MA_LOI := 0;
        END_IF
    END_IF

END_FUNCTION_BLOCK
// tệp: src/BangTaiTuanTu.st
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
VAR
    ChotLoiInst : ChotLoi;
    CurrentState : INT;
    NextState : INT;
    StartRise : R_TRIG;
    EntryTime : TIME;
END_VAR

    (* 1. Gọi ChotLoi *)
    ChotLoiInst(
        DUNG_KHAN := DUNG_KHAN,
        QT1 := QT1,
        QT2 := QT2,
        QT3 := QT3,
        RESET := RESET
    );
    LOI := ChotLoiInst.LOI;
    MA_LOI := ChotLoiInst.MA_LOI;

    (* 2. Xử lý trạng thái LOI ưu tiên cao nhất *)
    IF LOI THEN
        CurrentState := 9;
        TRANG_THAI := 9;
        B1 := FALSE;
        B2 := FALSE;
        B3 := FALSE;
        RETURN;
    END_IF

    (* Nếu thoát khỏi LOI (RESET thành công) => về DUNG *)
    IF CurrentState = 9 THEN
        CurrentState := 0;
    END_IF

    (* 3. Máy trạng thái *)
    NextState := CurrentState;
    StartRise(CLK := START);

    CASE CurrentState OF
        0: (* DUNG *)
            IF StartRise.Q AND NOT STOP THEN
                NextState := 1; (* KD_B3 *)
            END_IF

        1: (* KD_B3 *)
            IF STOP THEN
                NextState := 5; (* DUNG_B2 *)
            ELSIF G_NOW >= EntryTime + T_TRE THEN
                NextState := 2; (* KD_B2 *)
            END_IF

        2: (* KD_B2 *)
            IF STOP THEN
                NextState := 4; (* DUNG_B1 *)
            ELSIF G_NOW >= EntryTime + T_TRE THEN
                NextState := 3; (* CHAY *)
            END_IF

        3: (* CHAY *)
            IF STOP THEN
                NextState := 4; (* DUNG_B1 *)
            END_IF

        4: (* DUNG_B1 *)
            IF G_NOW >= EntryTime + T_TRE THEN
                NextState := 5; (* DUNG_B2 *)
            END_IF

        5: (* DUNG_B2 *)
            IF G_NOW >= EntryTime + T_TRE THEN
                NextState := 0; (* DUNG *)
            END_IF
    END_CASE

    CurrentState := NextState;

    (* Cập nhật EntryTime cho các trạng thái cần trễ *)
    IF CurrentState = 1 OR CurrentState = 2 OR CurrentState = 4 OR CurrentState = 5 THEN
        EntryTime := G_NOW;
    END_IF

    (* 4. Đầu ra *)
    TRANG_THAI := CurrentState;
    B1 := FALSE;
    B2 := FALSE;
    B3 := FALSE;

    CASE CurrentState OF
        1, 2, 3, 4, 5:
            B3 := TRUE;
        2, 3, 4:
            B2 := TRUE;
        3:
            B1 := TRUE;
    END_CASE

END_FUNCTION_BLOCK
