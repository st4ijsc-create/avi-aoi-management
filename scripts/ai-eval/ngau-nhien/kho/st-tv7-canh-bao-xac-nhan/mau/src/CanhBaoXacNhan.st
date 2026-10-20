FUNCTION_BLOCK CanhBaoXacNhan
VAR_INPUT
    DIEU_KIEN : BOOL;
    XAC_NHAN : BOOL;
    T_TRE : TIME;
END_VAR
VAR_OUTPUT
    TRANG_THAI : INT;
    NHAP_NHAY : BOOL;
    CO_CANH_BAO : BOOL;
END_VAR
VAR
    tre : TON;
    xn : R_TRIG;
    coDk : BOOL;    (* cảnh báo đang có hiệu lực (sau trễ) *)
    ack : BOOL;     (* sườn lên xác nhận *)
END_VAR
    tre(IN := DIEU_KIEN, PT := T_TRE);
    coDk := tre.Q;
    xn(CLK := XAC_NHAN);
    ack := xn.Q;
    CASE TRANG_THAI OF
        0:
            IF coDk THEN TRANG_THAI := 1; END_IF
        1:
            IF ack THEN
                TRANG_THAI := 2;
            ELSIF NOT coDk THEN
                TRANG_THAI := 3;
            END_IF
        2:
            IF NOT coDk THEN TRANG_THAI := 0; END_IF
        3:
            IF ack THEN
                TRANG_THAI := 0;
            ELSIF coDk THEN
                TRANG_THAI := 1;
            END_IF
    END_CASE
    NHAP_NHAY := (TRANG_THAI = 1) OR (TRANG_THAI = 3);
    CO_CANH_BAO := (TRANG_THAI = 1) OR (TRANG_THAI = 2);
END_FUNCTION_BLOCK
