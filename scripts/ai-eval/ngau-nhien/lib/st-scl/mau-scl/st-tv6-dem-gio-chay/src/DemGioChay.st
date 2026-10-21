FUNCTION_BLOCK "DemGioChay"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DANG_CHAY : Bool;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      GIO : UDInt;
      PHUT : UDInt;
      GIAY_TONG : UDInt;
   END_VAR

   VAR
      batDau : R_TRIG;
      tCu : Time;      // "G_NOW" của chu kỳ trước
      le : Time;       // phần lẻ dưới 1 s chưa cộng vào GIAY_TONG
   END_VAR

   REGION Cong don giay
      #batDau(CLK := #DANG_CHAY);
      IF #RESET THEN
         #GIAY_TONG := 0;
         #le := T#0s;
      ELSIF #DANG_CHAY AND NOT #batDau.Q THEN
         #le := #le + ("G_NOW" - #tCu);
         WHILE #le >= T#1s DO
            #le := #le - T#1s;
            #GIAY_TONG := #GIAY_TONG + 1;
         END_WHILE;
      END_IF;
      #tCu := "G_NOW";
   END_REGION

   #GIO := #GIAY_TONG / 3600;
   #PHUT := (#GIAY_TONG / 60) MOD 60;
END_FUNCTION_BLOCK
