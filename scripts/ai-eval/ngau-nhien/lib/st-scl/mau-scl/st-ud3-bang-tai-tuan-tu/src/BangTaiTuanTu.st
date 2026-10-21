FUNCTION_BLOCK "BangTaiTuanTu"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      START : Bool;
      STOP : Bool;
      DUNG_KHAN : Bool;
      QT1 : Bool;
      QT2 : Bool;
      QT3 : Bool;
      RESET : Bool;
      T_TRE : Time;
   END_VAR

   VAR_OUTPUT
      B1 : Bool;
      B2 : Bool;
      B3 : Bool;
      TRANG_THAI : Int;  // 0 DUNG, 1 KD_B3, 2 KD_B2, 3 CHAY, 4 DUNG_B1, 5 DUNG_B2, 9 LOI
      LOI : Bool;
      MA_LOI : Int;
   END_VAR

   VAR
      chot : "ChotLoi";
      rtStart : R_TRIG;
      tBuoc : TON_TIME;       // ET = thời gian đã ở trạng thái hiện tại
      ttTruoc : Int;
   END_VAR

   REGION Chot loi va suon START
      #chot(DUNG_KHAN := #DUNG_KHAN, QT1 := #QT1, QT2 := #QT2, QT3 := #QT3, RESET := #RESET);
      #LOI := #chot.LOI;
      #MA_LOI := #chot.MA_LOI;
      #rtStart(CLK := #START);
      #tBuoc(IN := TRUE, PT := T#24h);
   END_REGION

   REGION May trang thai
      IF #LOI THEN
         #TRANG_THAI := 9;
      ELSE
         CASE #TRANG_THAI OF
            0: IF #rtStart.Q AND NOT #STOP THEN #TRANG_THAI := 1; END_IF;
            1: IF #STOP THEN #TRANG_THAI := 5; ELSIF #tBuoc.ET >= #T_TRE THEN #TRANG_THAI := 2; END_IF;
            2: IF #STOP THEN #TRANG_THAI := 4; ELSIF #tBuoc.ET >= #T_TRE THEN #TRANG_THAI := 3; END_IF;
            3: IF #STOP THEN #TRANG_THAI := 4; END_IF;
            4: IF #tBuoc.ET >= #T_TRE THEN #TRANG_THAI := 5; END_IF;
            5: IF #tBuoc.ET >= #T_TRE THEN #TRANG_THAI := 0; END_IF;
            9: #TRANG_THAI := 0;
         END_CASE;
      END_IF;
      IF #TRANG_THAI <> #ttTruoc THEN
         #tBuoc(IN := FALSE);
         #tBuoc(IN := TRUE, PT := T#24h);
      END_IF;
      #ttTruoc := #TRANG_THAI;
   END_REGION

   #B3 := #TRANG_THAI >= 1 AND #TRANG_THAI <= 5;
   #B2 := #TRANG_THAI >= 2 AND #TRANG_THAI <= 4;
   #B1 := #TRANG_THAI = 3;
END_FUNCTION_BLOCK
