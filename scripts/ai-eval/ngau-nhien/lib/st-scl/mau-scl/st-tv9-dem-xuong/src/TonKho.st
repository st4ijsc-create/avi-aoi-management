FUNCTION_BLOCK "TonKho"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      LAY_RA : Bool;
      NAP : Bool;
      SO_NAP : Int;
      NGUONG_THAP : Int;
   END_VAR

   VAR_OUTPUT
      TON : Int;
      SAP_HET : Bool;
      HET : Bool;
   END_VAR

   VAR
      suon : R_TRIG;
      ctdTon : CTD_INT;
   END_VAR

   #suon(CLK := #LAY_RA);
   // chặn đếm xuống dưới 0: CTD chuẩn không tự chặn
   #ctdTon(CD := #suon.Q AND #ctdTon.CV > 0, LD := #NAP, PV := #SO_NAP);
   #TON := #ctdTon.CV;
   #SAP_HET := #TON <= #NGUONG_THAP;
   #HET := #TON = 0;
END_FUNCTION_BLOCK
