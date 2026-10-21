FUNCTION_BLOCK "TreHaiNguong"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      X : Real;
      SP : Real;
      TRE : Real;
   END_VAR

   VAR_OUTPUT
      Q : Bool;
   END_VAR

BEGIN
   IF #X <= #SP - #TRE THEN
      #Q := TRUE;
   ELSIF #X >= #SP + #TRE THEN
      #Q := FALSE;
   END_IF;
END_FUNCTION_BLOCK
