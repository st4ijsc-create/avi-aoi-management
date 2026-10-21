FUNCTION_BLOCK "NoiSuyBang"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      X : Real;
      BANG_X : Array[1..8] of Real;
      BANG_Y : Array[1..8] of Real;
      SO_DIEM : Int;
   END_VAR

   VAR_OUTPUT
      Y : Real;
      LOI : Bool;
      NGOAI_BANG : Bool;
   END_VAR

   VAR_TEMP
      i : Int;
      n : Int;
   END_VAR

BEGIN
   #LOI := (#SO_DIEM < 2) OR (#SO_DIEM > 8);
   IF NOT #LOI THEN
      FOR #i := 2 TO #SO_DIEM DO
         IF #BANG_X[#i] <= #BANG_X[#i - 1] THEN
            #LOI := TRUE;
         END_IF;
      END_FOR;
   END_IF;
   IF #LOI THEN
      #Y := 0.0;
      #NGOAI_BANG := FALSE;
   ELSE
      #n := #SO_DIEM;
      IF #X < #BANG_X[1] THEN
         #Y := #BANG_Y[1];
         #NGOAI_BANG := TRUE;
      ELSIF #X > #BANG_X[#n] THEN
         #Y := #BANG_Y[#n];
         #NGOAI_BANG := TRUE;
      ELSE
         #NGOAI_BANG := FALSE;
         #i := 2;
         WHILE (#i < #n) AND (#X > #BANG_X[#i]) DO
            #i := #i + 1;
         END_WHILE;
         #Y := #BANG_Y[#i - 1] + (#X - #BANG_X[#i - 1]) * (#BANG_Y[#i] - #BANG_Y[#i - 1]) / (#BANG_X[#i] - #BANG_X[#i - 1]);
      END_IF;
   END_IF;
END_FUNCTION_BLOCK
