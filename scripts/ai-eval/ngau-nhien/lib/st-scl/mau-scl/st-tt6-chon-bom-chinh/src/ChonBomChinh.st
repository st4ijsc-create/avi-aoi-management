FUNCTION_BLOCK "ChonBomChinh"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      GIO_CHAY : Array[1..4] of UDInt;
      SAN_SANG : Array[1..4] of Bool;
   END_VAR

   VAR_OUTPUT
      BOM : Int;
      THU_TU : Array[1..4] of Int;
   END_VAR

   VAR_TEMP
      i : Int;
      j : Int;
      n : Int;
      dich : Bool;
   END_VAR

   REGION Sap xep chen theo gio chay
      FOR #i := 1 TO 4 DO
         #THU_TU[#i] := 0;
      END_FOR;
      #n := 0;
      // sắp xếp chèn; duyệt i tăng dần + so sánh chặt => hoà giữ thứ tự chỉ số
      FOR #i := 1 TO 4 DO
         IF #SAN_SANG[#i] THEN
            #j := #n;
            #dich := TRUE;
            WHILE #dich DO
               IF #j < 1 THEN
                  #dich := FALSE;
               ELSIF #GIO_CHAY[#THU_TU[#j]] > #GIO_CHAY[#i] THEN
                  #THU_TU[#j + 1] := #THU_TU[#j];
                  #j := #j - 1;
               ELSE
                  #dich := FALSE;
               END_IF;
            END_WHILE;
            #THU_TU[#j + 1] := #i;
            #n := #n + 1;
         END_IF;
      END_FOR;
   END_REGION
   #BOM := #THU_TU[1];
END_FUNCTION_BLOCK
