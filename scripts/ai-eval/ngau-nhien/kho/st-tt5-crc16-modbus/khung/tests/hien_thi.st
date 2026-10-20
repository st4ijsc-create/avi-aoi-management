FUNCTION main : DINT
VAR
    d : ARRAY[0..63] OF BYTE;
END_VAR
    (* "123456789" *)
    d[0] := 16#31; d[1] := 16#32; d[2] := 16#33; d[3] := 16#34; d[4] := 16#35;
    d[5] := 16#36; d[6] := 16#37; d[7] := 16#38; d[8] := 16#39;
    KT_DINT('123456789 => 4B37', WORD_TO_DINT(Crc16Modbus(d, 9)), 16#4B37);
    KT_DINT('do dai 0 => FFFF', WORD_TO_DINT(Crc16Modbus(d, 0)), 16#FFFF);
    main := KT_TONG();
END_FUNCTION
