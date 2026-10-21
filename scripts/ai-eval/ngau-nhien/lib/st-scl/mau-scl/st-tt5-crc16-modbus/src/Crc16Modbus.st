FUNCTION "Crc16Modbus" : Word
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DU_LIEU : Array[0..63] of Byte;
      DO_DAI : Int;
   END_VAR

   VAR_TEMP
      n : Int;
      i : Int;
      j : Int;
      crc : Word;
   END_VAR

BEGIN
   #n := #DO_DAI;
   IF #n < 0 THEN #n := 0; END_IF;
   IF #n > 64 THEN #n := 64; END_IF;
   #crc := 16#FFFF;
   FOR #i := 0 TO #n - 1 DO
      #crc := #crc XOR BYTE_TO_WORD(#DU_LIEU[#i]);
      FOR #j := 1 TO 8 DO
         IF (#crc AND 16#0001) <> 0 THEN
            #crc := SHR(IN := #crc, N := 1) XOR 16#A001;
         ELSE
            #crc := SHR(IN := #crc, N := 1);
         END_IF;
      END_FOR;
   END_FOR;
   #Crc16Modbus := #crc;
END_FUNCTION
