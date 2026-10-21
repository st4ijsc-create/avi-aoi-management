FUNCTION_BLOCK "ThanhGhiDich"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DICH : Bool;
      GHI : Bool;
      XOA : Bool;
      VI_TRI : Int;
   END_VAR

   VAR_OUTPUT
      Q : Bool;
      SO_O : Int;
   END_VAR

   VAR
      o : Array[0..32] of Bool;
   END_VAR

   VAR_TEMP
      i : Int;
   END_VAR

   REGION Cap nhat thanh ghi
      IF #XOA THEN
         FOR #i := 0 TO 32 DO #o[#i] := FALSE; END_FOR;
      ELSE
         IF #DICH THEN
            FOR #i := 32 TO 1 BY -1 DO #o[#i] := #o[#i - 1]; END_FOR;
            #o[0] := FALSE;
         END_IF;
         IF #GHI THEN
            #o[0] := TRUE;
         END_IF;
      END_IF;
   END_REGION

   REGION Doc vi tri va dem o
      IF #VI_TRI >= 0 AND #VI_TRI <= 32 THEN
         #Q := #o[#VI_TRI];
      ELSE
         #Q := FALSE;
      END_IF;
      #SO_O := 0;
      FOR #i := 0 TO 32 DO
         IF #o[#i] THEN #SO_O := #SO_O + 1; END_IF;
      END_FOR;
   END_REGION
END_FUNCTION_BLOCK
