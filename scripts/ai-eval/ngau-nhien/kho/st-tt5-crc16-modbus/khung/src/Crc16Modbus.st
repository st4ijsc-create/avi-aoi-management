FUNCTION Crc16Modbus : WORD
VAR_INPUT
    DU_LIEU : ARRAY[0..63] OF BYTE;
    DO_DAI : INT;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    Crc16Modbus := 0;
END_FUNCTION
