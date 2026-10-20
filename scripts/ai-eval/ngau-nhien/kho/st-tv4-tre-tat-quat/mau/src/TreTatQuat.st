FUNCTION_BLOCK TreTatQuat
VAR_INPUT
    LENH : BOOL;
    DUNG_KHAN : BOOL;
    T_CHAY_THEM : TIME;
END_VAR
VAR_OUTPUT
    QUAT : BOOL;
    CON_LAI : TIME;
END_VAR
VAR
    tre : TOF;
    huy : BOOL;    (* chạy thêm đã bị DUNG_KHAN hủy *)
    chay : BOOL;
END_VAR
    chay := LENH AND NOT DUNG_KHAN;
    IF DUNG_KHAN THEN
        huy := TRUE;
    ELSIF chay THEN
        huy := FALSE;
    END_IF
    tre(IN := chay, PT := T_CHAY_THEM);
    QUAT := tre.Q AND NOT huy;
    IF QUAT AND NOT chay THEN
        CON_LAI := T_CHAY_THEM - tre.ET;
    ELSE
        CON_LAI := T#0s;
    END_IF
END_FUNCTION_BLOCK
