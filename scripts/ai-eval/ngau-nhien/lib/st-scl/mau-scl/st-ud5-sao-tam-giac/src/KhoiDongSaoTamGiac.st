FUNCTION_BLOCK "KhoiDongSaoTamGiac"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      START : Bool;
      STOP : Bool;
      QUA_TAI : Bool;
      RESET : Bool;
      T_SAO : Time;
      T_KHE : Time;
   END_VAR

   VAR_OUTPUT
      KM_CHINH : Bool;
      KM_SAO : Bool;
      KM_TAM_GIAC : Bool;
      LOI_QT : Bool;
      TRANG_THAI : Int;  // 0 DUNG, 1 SAO, 2 KHE, 3 TAM_GIAC, 9 LOI
   END_VAR

   VAR
      khoa : "KhoaChuyenMach";
      rtStart : R_TRIG;
      tBuoc : TON_TIME;       // ET = thời gian đã ở trạng thái hiện tại
      ttTruoc : Int;
   END_VAR

   REGION Chot qua tai
      // Quá tải chốt, đặt thắng RESET
      #LOI_QT := #QUA_TAI OR (#LOI_QT AND NOT #RESET);
      #rtStart(CLK := #START);
      #tBuoc(IN := TRUE, PT := T#24h);
   END_REGION

   REGION May trang thai
      IF #LOI_QT THEN
         #TRANG_THAI := 9;
      ELSE
         CASE #TRANG_THAI OF
            0: IF #rtStart.Q AND NOT #STOP THEN #TRANG_THAI := 1; END_IF;
            1: IF #STOP THEN #TRANG_THAI := 0; ELSIF #tBuoc.ET >= #T_SAO THEN #TRANG_THAI := 2; END_IF;
            2: IF #STOP THEN #TRANG_THAI := 0; ELSIF #tBuoc.ET >= #T_KHE THEN #TRANG_THAI := 3; END_IF;
            3: IF #STOP THEN #TRANG_THAI := 0; END_IF;
            9: #TRANG_THAI := 0;
         END_CASE;
      END_IF;
      IF #TRANG_THAI <> #ttTruoc THEN
         #tBuoc(IN := FALSE);
         #tBuoc(IN := TRUE, PT := T#24h);
      END_IF;
      #ttTruoc := #TRANG_THAI;
   END_REGION

   #khoa(YC_SAO := (#TRANG_THAI = 1), YC_TG := (#TRANG_THAI = 3));
   #KM_CHINH := #TRANG_THAI >= 1 AND #TRANG_THAI <= 3;
   #KM_SAO := #khoa.KM_SAO;
   #KM_TAM_GIAC := #khoa.KM_TAM_GIAC;
END_FUNCTION_BLOCK
