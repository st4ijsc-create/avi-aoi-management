FUNCTION Crc16Modbus : WORD
VAR_INPUT
    DU_LIEU : ARRAY[0..63] OF BYTE;
    DO_DAI : INT;
END_VAR
VAR
    n : INT;
    i : INT;
    j : INT;
    crc : WORD;
END_VAR
    n := DO_DAI;
    IF n < 0 THEN n := 0; END_IF
    IF n > 64 THEN n := 64; END_IF
    crc := 16#FFFF;
    FOR i := 0 TO n - 1 DO
        crc := crc XOR BYTE_TO_WORD(DU_LIEU[i]);
        FOR j := 1 TO 8 DO
            IF (crc AND 16#0001) <> 0 THEN
                crc := SHR(crc, 1) XOR 16#A001;
            ELSE
                crc := SHR(crc, 1);
            END_IF
        END_FOR
    END_FOR
    Crc16Modbus := crc;
END_FUNCTION
