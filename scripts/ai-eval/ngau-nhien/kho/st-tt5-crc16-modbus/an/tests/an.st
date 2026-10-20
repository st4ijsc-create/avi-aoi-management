FUNCTION main : DINT
VAR
    d : ARRAY[0..63] OF BYTE;
    i : INT;
END_VAR
    (* Kỳ vọng: vector CRC-16/MODBUS công bố (123456789 ⇒ 4B37; ví dụ Modbus 11 03 00 6B 00 03 ⇒ byte 76 87;
       01 03 00 01 00 01 ⇒ byte D5 CA) + tính độc lập bằng cài đặt JS riêng (không chạy lời giải mẫu). *)
    d[0] := 16#31; d[1] := 16#32; d[2] := 16#33; d[3] := 16#34; d[4] := 16#35;
    d[5] := 16#36; d[6] := 16#37; d[7] := 16#38; d[8] := 16#39;
    KT_DINT('123456789', WORD_TO_DINT(Crc16Modbus(d, 9)), 16#4B37);
    KT_DINT('rong', WORD_TO_DINT(Crc16Modbus(d, 0)), 16#FFFF);
    KT_DINT('do dai am => 0 => FFFF', WORD_TO_DINT(Crc16Modbus(d, -5)), 16#FFFF);
    KT_DINT('do dai am lon', WORD_TO_DINT(Crc16Modbus(d, -32768)), 16#FFFF);

    (* khung 01 03 00 00 00 0A ⇒ CDC5 (truyền C5 CD) *)
    d[0] := 16#01; d[1] := 16#03; d[2] := 16#00; d[3] := 16#00; d[4] := 16#00; d[5] := 16#0A;
    KT_DINT('01 03 00 00 00 0A', WORD_TO_DINT(Crc16Modbus(d, 6)), 16#CDC5);
    (* khung kèm CRC (byte thấp trước) ⇒ phần dư 0 *)
    d[6] := 16#C5; d[7] := 16#CD;
    KT_DINT('khung + CRC => 0', WORD_TO_DINT(Crc16Modbus(d, 8)), 0);
    (* chỉ DO_DAI byte đầu được tính: byte thừa phía sau không ảnh hưởng *)
    KT_DINT('byte thua bi bo qua', WORD_TO_DINT(Crc16Modbus(d, 6)), 16#CDC5);

    d[0] := 16#01; d[1] := 16#03; d[2] := 16#00; d[3] := 16#01; d[4] := 16#00; d[5] := 16#01;
    KT_DINT('01 03 00 01 00 01', WORD_TO_DINT(Crc16Modbus(d, 6)), 16#CAD5);
    d[0] := 16#11; d[1] := 16#03; d[2] := 16#00; d[3] := 16#6B; d[4] := 16#00; d[5] := 16#03;
    KT_DINT('11 03 00 6B 00 03', WORD_TO_DINT(Crc16Modbus(d, 6)), 16#8776);

    d[0] := 16#00;
    KT_DINT('mot byte 00', WORD_TO_DINT(Crc16Modbus(d, 1)), 16#40BF);
    d[0] := 16#FF;
    KT_DINT('mot byte FF', WORD_TO_DINT(Crc16Modbus(d, 1)), 16#00FF);

    (* d[i] = i, i = 0..63 *)
    FOR i := 0 TO 63 DO
        d[i] := INT_TO_BYTE(i);
    END_FOR
    KT_DINT('64 byte day du', WORD_TO_DINT(Crc16Modbus(d, 64)), 16#08D9);
    KT_DINT('63 byte', WORD_TO_DINT(Crc16Modbus(d, 63)), 16#5921);
    KT_DINT('do dai 100 => kep 64', WORD_TO_DINT(Crc16Modbus(d, 100)), 16#08D9);
    KT_DINT('do dai 65 => kep 64', WORD_TO_DINT(Crc16Modbus(d, 65)), 16#08D9);
    KT_DINT('do dai 32767 => kep 64', WORD_TO_DINT(Crc16Modbus(d, 32767)), 16#08D9);
    main := KT_TONG();
END_FUNCTION
