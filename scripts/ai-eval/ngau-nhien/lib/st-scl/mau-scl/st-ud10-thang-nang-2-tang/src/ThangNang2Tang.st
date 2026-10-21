FUNCTION_BLOCK "ThangNang2Tang"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      GOI_1 : Bool;
      GOI_2 : Bool;
      CT_TANG_1 : Bool;
      CT_TANG_2 : Bool;
      CUA_DONG : Bool;
      DUNG_KHAN : Bool;
      RESET : Bool;
      T_DI_CHUYEN : Time;
   END_VAR

   VAR_OUTPUT
      LEN : Bool;
      XUONG : Bool;
      TRANG_THAI : Int;  // 0 DUNG_YEN, 1 DI_LEN, 2 DI_XUONG, 9 LOI
      TANG : Int;        // 0 chưa biết, 1, 2
      MA_LOI : Int;      // 0, 1 quá giờ, 2 dừng khẩn
   END_VAR

   VAR
      khoa : "KhoaDongCo";
      tBuoc : TON_TIME;       // ET = thời gian đã ở trạng thái hiện tại
      ttTruoc : Int;
   END_VAR

BEGIN
   IF #CT_TANG_1 AND NOT #CT_TANG_2 THEN
      #TANG := 1;
   ELSIF #CT_TANG_2 AND NOT #CT_TANG_1 THEN
      #TANG := 2;
   END_IF;
   #tBuoc(IN := TRUE, PT := T#24h);

   IF #DUNG_KHAN THEN
      #TRANG_THAI := 9;
      #MA_LOI := 2;
   ELSE
      CASE #TRANG_THAI OF
         0:
            IF #CUA_DONG AND NOT (#GOI_1 AND #GOI_2) THEN
               IF #GOI_2 AND NOT #CT_TANG_2 THEN
                  #TRANG_THAI := 1;
               ELSIF #GOI_1 AND NOT #CT_TANG_1 THEN
                  #TRANG_THAI := 2;
               END_IF;
            END_IF;
         1:
            IF #CT_TANG_2 OR NOT #CUA_DONG THEN
               #TRANG_THAI := 0;
            ELSIF #tBuoc.ET >= #T_DI_CHUYEN THEN
               #TRANG_THAI := 9;
               #MA_LOI := 1;
            END_IF;
         2:
            IF #CT_TANG_1 OR NOT #CUA_DONG THEN
               #TRANG_THAI := 0;
            ELSIF #tBuoc.ET >= #T_DI_CHUYEN THEN
               #TRANG_THAI := 9;
               #MA_LOI := 1;
            END_IF;
         9:
            IF #RESET THEN
               #TRANG_THAI := 0;
               #MA_LOI := 0;
            END_IF;
      END_CASE;
   END_IF;
   IF #TRANG_THAI <> #ttTruoc THEN
      #tBuoc(IN := FALSE);
      #tBuoc(IN := TRUE, PT := T#24h);
   END_IF;
   #ttTruoc := #TRANG_THAI;

   #khoa(YC_LEN := (#TRANG_THAI = 1), YC_XUONG := (#TRANG_THAI = 2), CUA_DONG := #CUA_DONG, DUNG_KHAN := #DUNG_KHAN);
   #LEN := #khoa.LEN;
   #XUONG := #khoa.XUONG;
END_FUNCTION_BLOCK
