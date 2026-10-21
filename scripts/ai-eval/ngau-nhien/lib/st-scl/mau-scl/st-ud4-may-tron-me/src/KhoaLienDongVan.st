FUNCTION_BLOCK "KhoaLienDongVan"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      YC_A : Bool;
      YC_B : Bool;
      YC_XA : Bool;
   END_VAR

   VAR_OUTPUT
      VAN_A : Bool;
      VAN_B : Bool;
      VAN_XA : Bool;
      XUNG_DOT : Bool;
   END_VAR

BEGIN
   #XUNG_DOT := (BOOL_TO_INT(#YC_A) + BOOL_TO_INT(#YC_B) + BOOL_TO_INT(#YC_XA)) > 1;
   #VAN_A := #YC_A AND NOT #XUNG_DOT;
   #VAN_B := #YC_B AND NOT #XUNG_DOT;
   #VAN_XA := #YC_XA AND NOT #XUNG_DOT;
END_FUNCTION_BLOCK
