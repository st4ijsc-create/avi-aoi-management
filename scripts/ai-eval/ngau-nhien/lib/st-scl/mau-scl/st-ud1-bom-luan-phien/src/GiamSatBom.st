FUNCTION_BLOCK "GiamSatBom"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      LENH : Bool;
      PHAN_HOI : Bool;
      RESET : Bool;
      T_PHAN_HOI : Time;
   END_VAR

   VAR_OUTPUT
      LOI : Bool;
   END_VAR

   VAR
      tMat : TON_TIME;
   END_VAR

   #tMat(IN := #LENH AND NOT #PHAN_HOI, PT := #T_PHAN_HOI);
   IF #RESET THEN
      #LOI := FALSE;
   ELSIF #tMat.Q THEN
      #LOI := TRUE;
   END_IF;
END_FUNCTION_BLOCK
