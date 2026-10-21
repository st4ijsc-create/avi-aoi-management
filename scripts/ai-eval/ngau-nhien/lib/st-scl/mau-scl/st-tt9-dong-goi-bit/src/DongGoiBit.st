FUNCTION "DongGoiBit" : Word
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      BIT : Array[0..15] of Bool;
   END_VAR

   VAR_TEMP
      i : Int;
      w : Word;
   END_VAR

   REGION Dong goi 16 bit
      #w := 0;
      FOR #i := 0 TO 15 DO
         IF #BIT[#i] THEN
            #w := #w OR SHL(IN := WORD#1, N := #i);
         END_IF;
      END_FOR;
      #DongGoiBit := #w;
   END_REGION
END_FUNCTION

FUNCTION_BLOCK "MoGoiBit"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      GIA_TRI : Word;
   END_VAR

   VAR_OUTPUT
      BIT : Array[0..15] of Bool;
      SO_BIT_1 : Int;
   END_VAR

   VAR_TEMP
      i : Int;
   END_VAR

   REGION Mo goi bit
      #SO_BIT_1 := 0;
      FOR #i := 0 TO 15 DO
         #BIT[#i] := (#GIA_TRI AND SHL(IN := WORD#1, N := #i)) <> 0;
         IF #BIT[#i] THEN
            #SO_BIT_1 := #SO_BIT_1 + 1;
         END_IF;
      END_FOR;
   END_REGION
END_FUNCTION_BLOCK
