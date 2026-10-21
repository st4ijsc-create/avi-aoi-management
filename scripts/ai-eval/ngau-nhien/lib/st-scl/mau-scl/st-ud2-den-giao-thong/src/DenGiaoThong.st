FUNCTION_BLOCK "DenGiaoThong"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      NUT_NGUOI : Bool;
      NHAP_NHAY_VANG : Bool;
      T_XANH_MIN : Time;
      T_VANG : Time;
      T_NGUOI : Time;
      T_DO_CHUNG : Time;
      T_NHAY : Time;
   END_VAR

   VAR_OUTPUT
      XE_XANH : Bool;
      XE_VANG : Bool;
      XE_DO : Bool;
      NG_XANH : Bool;
      NG_DO : Bool;
      TRANG_THAI : Int;  // 0 XANH_XE, 1 VANG, 2 NGUOI_DI, 3 DO_CHUNG, 4 NHAP_NHAY
   END_VAR

   VAR
      nn : "NhapNhay";
      tBuoc : IEC_TIMER;       // ET = thời gian đã ở trạng thái hiện tại
      yeuCau : Bool;
      ttTruoc : Int;
   END_VAR

   #tBuoc.TON(IN := TRUE, PT := T#24h);
   IF #NUT_NGUOI AND #TRANG_THAI = 0 THEN
      #yeuCau := TRUE;
   END_IF;

   IF #NHAP_NHAY_VANG THEN
      #TRANG_THAI := 4;
   ELSE
      CASE #TRANG_THAI OF
         0: IF #yeuCau AND #tBuoc.ET >= #T_XANH_MIN THEN #TRANG_THAI := 1; END_IF;
         1: IF #tBuoc.ET >= #T_VANG THEN #TRANG_THAI := 2; END_IF;
         2: IF #tBuoc.ET >= #T_NGUOI THEN #TRANG_THAI := 3; END_IF;
         3: IF #tBuoc.ET >= #T_DO_CHUNG THEN #TRANG_THAI := 0; END_IF;
         4: #TRANG_THAI := 3;
      END_CASE;
   END_IF;
   IF #TRANG_THAI <> 0 THEN
      #yeuCau := FALSE;
   END_IF;
   IF #TRANG_THAI <> #ttTruoc THEN
      #tBuoc.TON(IN := FALSE);
      #tBuoc.TON(IN := TRUE, PT := T#24h);
   END_IF;
   #ttTruoc := #TRANG_THAI;

   #nn(EN := (#TRANG_THAI = 4), T_NUA := #T_NHAY);
   #XE_XANH := #TRANG_THAI = 0;
   #XE_VANG := #TRANG_THAI = 1 OR (#TRANG_THAI = 4 AND #nn.Q);
   #XE_DO := #TRANG_THAI = 2 OR #TRANG_THAI = 3;
   #NG_XANH := #TRANG_THAI = 2;
   #NG_DO := #TRANG_THAI = 0 OR #TRANG_THAI = 1 OR #TRANG_THAI = 3;
END_FUNCTION_BLOCK
