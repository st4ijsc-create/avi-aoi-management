FUNCTION_BLOCK "KhoaDongCo"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      YC_LEN : Bool;
      YC_XUONG : Bool;
      CUA_DONG : Bool;
      DUNG_KHAN : Bool;
   END_VAR

   VAR_OUTPUT
      LEN : Bool;
      XUONG : Bool;
   END_VAR

   VAR_TEMP
      choPhep : Bool;
   END_VAR

BEGIN
   #choPhep := #CUA_DONG AND NOT #DUNG_KHAN AND NOT (#YC_LEN AND #YC_XUONG);
   #LEN := #YC_LEN AND #choPhep;
   #XUONG := #YC_XUONG AND #choPhep;
END_FUNCTION_BLOCK
