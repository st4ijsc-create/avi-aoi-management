FUNCTION_BLOCK "XungKhoiDong"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      NUT : Bool;
      T_XUNG : Time;
      KHOA : Bool;
   END_VAR

   VAR_OUTPUT
      XUNG : Bool;
      SO_LAN : UDInt;
   END_VAR

   VAR
      suon : R_TRIG;
      xungTp : TP_TIME;
      xungCu : Bool;
   END_VAR

   #suon(CLK := #NUT);
   IF #KHOA THEN
      // cắt xung: PT = 0 làm TP kết thúc ngay, sẵn sàng cho sườn sau
      #xungTp(IN := FALSE, PT := t#0s);
   ELSE
      #xungTp(IN := #suon.Q, PT := #T_XUNG);
      IF #xungTp.Q AND NOT #xungCu THEN
         #SO_LAN := #SO_LAN + 1;
      END_IF;
   END_IF;
   #XUNG := #xungTp.Q;
   #xungCu := #XUNG;
END_FUNCTION_BLOCK
