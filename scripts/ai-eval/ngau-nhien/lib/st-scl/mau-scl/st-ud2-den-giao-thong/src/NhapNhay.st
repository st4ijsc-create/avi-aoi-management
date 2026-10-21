FUNCTION_BLOCK "NhapNhay"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      EN : Bool;
      T_NUA : Time;
   END_VAR

   VAR_OUTPUT
      Q : Bool;
   END_VAR

   VAR
      tDao : IEC_TIMER;
      dangBat : Bool;
   END_VAR

   IF NOT #EN THEN
      #Q := FALSE;
      #dangBat := FALSE;
      #tDao.TON(IN := FALSE);
   ELSE
      IF NOT #dangBat THEN
         #dangBat := TRUE;
         #Q := TRUE;
         #tDao.TON(IN := FALSE);
      END_IF;
      #tDao.TON(IN := TRUE, PT := #T_NUA);
      IF #tDao.Q THEN
         #Q := NOT #Q;
         #tDao.TON(IN := FALSE);
         #tDao.TON(IN := TRUE, PT := #T_NUA);
      END_IF;
   END_IF;
END_FUNCTION_BLOCK
