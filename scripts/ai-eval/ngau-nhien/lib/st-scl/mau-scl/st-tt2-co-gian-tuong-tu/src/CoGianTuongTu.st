FUNCTION_BLOCK "CoGianTuongTu"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      THO : Int;
      KT_THAP : Real;
      KT_CAO : Real;
   END_VAR

   VAR_OUTPUT
      GIA_TRI : Real;
      DUOI_DAI : Bool;
      TREN_DAI : Bool;
      LOI : Bool;
   END_VAR

   VAR_TEMP
      v : Real;
      lo : Real;
      hi : Real;
   END_VAR

BEGIN
   REGION Kiem tra dai tho
      #DUOI_DAI := #THO < -1382;
      #TREN_DAI := #THO > 32511;
      #LOI := #DUOI_DAI OR #TREN_DAI;
   END_REGION

   REGION Quy doi ky thuat
      IF NOT #LOI THEN
         #v := #KT_THAP + INT_TO_REAL(#THO) / 27648.0 * (#KT_CAO - #KT_THAP);
         #lo := MIN(IN1 := #KT_THAP, IN2 := #KT_CAO);
         #hi := MAX(IN1 := #KT_THAP, IN2 := #KT_CAO);
         #GIA_TRI := LIMIT(MN := #lo, IN := #v, MX := #hi);
      END_IF;
   END_REGION
END_FUNCTION_BLOCK
