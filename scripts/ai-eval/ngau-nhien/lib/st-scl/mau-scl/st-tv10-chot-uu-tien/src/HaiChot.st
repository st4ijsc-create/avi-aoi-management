FUNCTION_BLOCK "HaiChot"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DAT : Bool;
      XOA : Bool;
   END_VAR

   VAR_OUTPUT
      Q_SR : Bool;
      Q_RS : Bool;
      DOI_TRANG_THAI : UDInt;
   END_VAR

   VAR
      chotSR : SR;
      chotRS : RS;
      qSrCu : Bool;
   END_VAR

   REGION Hai chot
      #chotSR(SET1 := #DAT, RESET := #XOA);
      #chotRS(SET := #DAT, RESET1 := #XOA);
      #Q_SR := #chotSR.Q1;
      #Q_RS := #chotRS.Q1;
   END_REGION

   REGION Dem doi trang thai
      IF #Q_SR <> #qSrCu THEN
         #DOI_TRANG_THAI := #DOI_TRANG_THAI + 1;
      END_IF;
      #qSrCu := #Q_SR;
   END_REGION
END_FUNCTION_BLOCK
