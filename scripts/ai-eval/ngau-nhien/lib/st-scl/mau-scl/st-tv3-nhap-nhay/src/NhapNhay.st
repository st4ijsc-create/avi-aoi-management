FUNCTION_BLOCK "NhapNhay"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      BAT : BOOL;
      T_SANG : TIME;
      T_TOI : TIME;
   END_VAR

   VAR_OUTPUT
      DEN : BOOL;
   END_VAR

   VAR
      tg : IEC_TIMER;
      toi : BOOL;   // đang ở pha tối
   END_VAR

   IF NOT #BAT THEN
      #toi := FALSE;
      #tg.TON(IN := FALSE);
   ELSE
      IF #toi THEN
         #tg.TON(IN := TRUE, PT := #T_TOI);
      ELSE
         #tg.TON(IN := TRUE, PT := #T_SANG);
      END_IF;
      IF #tg.Q THEN
         // đổi pha; mốc pha mới = chu kỳ này
         #toi := NOT #toi;
         #tg.TON(IN := FALSE);
         IF #toi THEN
            #tg.TON(IN := TRUE, PT := #T_TOI);
         ELSE
            #tg.TON(IN := TRUE, PT := #T_SANG);
         END_IF;
      END_IF;
   END_IF;
   #DEN := #BAT AND NOT #toi;
END_FUNCTION_BLOCK
