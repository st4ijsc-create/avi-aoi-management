FUNCTION "ViTriVan" : Int
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      CT_MO : Bool;
      CT_DONG : Bool;
   END_VAR

   REGION Giai ma vi tri van
      IF #CT_MO AND #CT_DONG THEN
         #ViTriVan := 3;
      ELSIF #CT_MO THEN
         #ViTriVan := 1;
      ELSIF #CT_DONG THEN
         #ViTriVan := 2;
      ELSE
         #ViTriVan := 0;
      END_IF;
   END_REGION
END_FUNCTION
