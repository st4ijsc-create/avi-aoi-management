FUNCTION "BcdSangInt" : Int
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      BCD : Word;
   END_VAR

   VAR_OUTPUT
      LOI : Bool;
   END_VAR

   VAR_TEMP
      k : Int;
      nib : Int;
      v : Int;
   END_VAR

   REGION Giai ma tung nibble
      #LOI := FALSE;
      #v := 0;
      FOR #k := 3 TO 0 BY -1 DO
         #nib := WORD_TO_INT(SHR(IN := #BCD, N := #k * 4) AND 16#000F);
         IF #nib > 9 THEN
            #LOI := TRUE;
         END_IF;
         #v := #v * 10 + #nib;
      END_FOR;
      IF #LOI THEN
         #v := 0;
      END_IF;
      #BcdSangInt := #v;
   END_REGION
END_FUNCTION

FUNCTION "IntSangBcd" : Word
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      GIA_TRI : Int;
   END_VAR

   VAR_OUTPUT
      LOI : Bool;
   END_VAR

   VAR_TEMP
      k : Int;
      x : Int;
      w : Word;
   END_VAR

   REGION Ma hoa BCD
      #w := 0;
      IF (#GIA_TRI < 0) OR (#GIA_TRI > 9999) THEN
         #LOI := TRUE;
      ELSE
         #LOI := FALSE;
         #x := #GIA_TRI;
         FOR #k := 0 TO 3 DO
            #w := #w OR SHL(IN := INT_TO_WORD(#x MOD 10), N := #k * 4);
            #x := #x / 10;
         END_FOR;
      END_IF;
      #IntSangBcd := #w;
   END_REGION
END_FUNCTION
