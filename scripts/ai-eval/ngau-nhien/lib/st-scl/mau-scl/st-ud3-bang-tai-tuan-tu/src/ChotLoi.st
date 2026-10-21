FUNCTION_BLOCK "ChotLoi"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DUNG_KHAN : Bool;
      QT1 : Bool;
      QT2 : Bool;
      QT3 : Bool;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      LOI : Bool;
      MA_LOI : Int;
   END_VAR

   VAR_TEMP
      coNguyenNhan : Bool;
   END_VAR

   REGION Chot loi
      #coNguyenNhan := #DUNG_KHAN OR #QT1 OR #QT2 OR #QT3;
      IF NOT #LOI AND #coNguyenNhan THEN
         #LOI := TRUE;
         IF #DUNG_KHAN THEN #MA_LOI := 1;
         ELSIF #QT1 THEN #MA_LOI := 11;
         ELSIF #QT2 THEN #MA_LOI := 12;
         ELSE #MA_LOI := 13;
         END_IF;
      ELSIF #LOI AND #RESET AND NOT #coNguyenNhan THEN
         #LOI := FALSE;
         #MA_LOI := 0;
      END_IF;
   END_REGION
END_FUNCTION_BLOCK
