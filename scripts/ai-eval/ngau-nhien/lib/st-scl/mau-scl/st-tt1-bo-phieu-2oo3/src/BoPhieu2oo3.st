FUNCTION_BLOCK "BoPhieu2oo3"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      A : Bool;
      B : Bool;
      C : Bool;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      Q : Bool;
      LECH : Bool;
      KENH_LECH : Int;
      DEM_LECH : DInt;
   END_VAR

   VAR
      lechCu : Bool;
   END_VAR

   VAR_TEMP
      soTrue : Int;
   END_VAR

   REGION Bo phieu va phat hien lech
      #soTrue := BOOL_TO_INT(#A) + BOOL_TO_INT(#B) + BOOL_TO_INT(#C);
      #Q := #soTrue >= 2;
      #LECH := (#soTrue = 1) OR (#soTrue = 2);
      IF NOT #LECH THEN
         #KENH_LECH := 0;
      ELSIF #soTrue = 1 THEN
         // kênh lệch là kênh TRUE duy nhất
         IF #A THEN #KENH_LECH := 1; ELSIF #B THEN #KENH_LECH := 2; ELSE #KENH_LECH := 3; END_IF;
      ELSE
         // kênh lệch là kênh FALSE duy nhất
         IF NOT #A THEN #KENH_LECH := 1; ELSIF NOT #B THEN #KENH_LECH := 2; ELSE #KENH_LECH := 3; END_IF;
      END_IF;
   END_REGION

   REGION Dem lan lech
      IF #RESET THEN
         #DEM_LECH := 0;
      ELSIF #LECH AND NOT #lechCu THEN
         #DEM_LECH := #DEM_LECH + 1;
      END_IF;
      #lechCu := #LECH;
   END_REGION
END_FUNCTION_BLOCK
