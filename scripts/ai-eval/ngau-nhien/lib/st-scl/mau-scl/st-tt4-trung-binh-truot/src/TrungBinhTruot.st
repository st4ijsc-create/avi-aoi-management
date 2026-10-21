FUNCTION_BLOCK "TrungBinhTruot"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      MAU : Real;
      LAY_MAU : Bool;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      TB : Real;
      SO_MAU : Int;
      HOP_LE : Bool;
   END_VAR

   VAR
      dem : Array[0..7] of Real;
      viTri : Int;
      layCu : Bool;
   END_VAR

   VAR_TEMP
      i : Int;
      tong : Real;
   END_VAR

   REGION Ghi mau vao bo dem vong
      IF #RESET THEN
         FOR #i := 0 TO 7 DO
            #dem[#i] := 0.0;
         END_FOR;
         #viTri := 0;
         #SO_MAU := 0;
      ELSIF #LAY_MAU AND NOT #layCu THEN
         #dem[#viTri] := #MAU;
         #viTri := (#viTri + 1) MOD 8;
         IF #SO_MAU < 8 THEN
            #SO_MAU := #SO_MAU + 1;
         END_IF;
      END_IF;
      #layCu := #LAY_MAU;
   END_REGION

   REGION Tinh trung binh
      // ô chưa dùng luôn = 0 nên cộng cả 8 ô
      #tong := 0.0;
      FOR #i := 0 TO 7 DO
         #tong := #tong + #dem[#i];
      END_FOR;
      IF #SO_MAU > 0 THEN
         #TB := #tong / INT_TO_REAL(#SO_MAU);
      ELSE
         #TB := 0.0;
      END_IF;
      #HOP_LE := #SO_MAU = 8;
   END_REGION
END_FUNCTION_BLOCK
