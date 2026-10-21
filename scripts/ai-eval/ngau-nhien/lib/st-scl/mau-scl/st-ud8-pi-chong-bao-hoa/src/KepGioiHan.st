FUNCTION "KepGioiHan" : Real
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      X : Real;
      LO : Real;
      HI : Real;
   END_VAR

BEGIN
   IF #X < #LO THEN
      #KepGioiHan := #LO;
   ELSIF #X > #HI THEN
      #KepGioiHan := #HI;
   ELSE
      #KepGioiHan := #X;
   END_IF;
END_FUNCTION
