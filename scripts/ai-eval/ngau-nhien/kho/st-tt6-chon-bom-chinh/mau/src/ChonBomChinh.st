FUNCTION_BLOCK ChonBomChinh
VAR_INPUT
    GIO_CHAY : ARRAY[1..4] OF UDINT;
    SAN_SANG : ARRAY[1..4] OF BOOL;
END_VAR
VAR_OUTPUT
    BOM : INT;
    THU_TU : ARRAY[1..4] OF INT;
END_VAR
VAR
    i : INT;
    j : INT;
    n : INT;
    dich : BOOL;
END_VAR
    FOR i := 1 TO 4 DO
        THU_TU[i] := 0;
    END_FOR
    n := 0;
    (* sắp xếp chèn; duyệt i tăng dần + so sánh chặt ⇒ hoà giữ thứ tự chỉ số *)
    FOR i := 1 TO 4 DO
        IF SAN_SANG[i] THEN
            j := n;
            dich := TRUE;
            WHILE dich DO
                IF j < 1 THEN
                    dich := FALSE;
                ELSIF GIO_CHAY[THU_TU[j]] > GIO_CHAY[i] THEN
                    THU_TU[j + 1] := THU_TU[j];
                    j := j - 1;
                ELSE
                    dich := FALSE;
                END_IF
            END_WHILE
            THU_TU[j + 1] := i;
            n := n + 1;
        END_IF
    END_FOR
    BOM := THU_TU[1];
END_FUNCTION_BLOCK
