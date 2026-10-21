FUNCTION_BLOCK "ChongDoi"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      IN : Bool;
      T_BAT : Time;
      T_TAT : Time;
   END_VAR

   VAR_OUTPUT
      Q : Bool;
   END_VAR

   VAR
      tonBat : IEC_TIMER;
      tonTat : IEC_TIMER;
   END_VAR

   #tonBat.TON(IN := #IN, PT := #T_BAT);
   #tonTat.TON(IN := NOT #IN, PT := #T_TAT);
   IF #tonBat.Q THEN
      #Q := TRUE;
   ELSIF #tonTat.Q THEN
      #Q := FALSE;
   END_IF;
END_FUNCTION_BLOCK
