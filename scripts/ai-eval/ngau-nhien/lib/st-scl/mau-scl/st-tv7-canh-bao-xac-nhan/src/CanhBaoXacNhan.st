FUNCTION_BLOCK "CanhBaoXacNhan"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DIEU_KIEN : Bool;
      XAC_NHAN : Bool;
      T_TRE : Time;
   END_VAR

   VAR_OUTPUT
      TRANG_THAI : Int;
      NHAP_NHAY : Bool;
      CO_CANH_BAO : Bool;
   END_VAR

   VAR
      tre : IEC_TIMER;
      xn : R_TRIG;
   END_VAR

   VAR_TEMP
      coDk : Bool;    // cảnh báo đang có hiệu lực (sau trễ)
      ack : Bool;     // sườn lên xác nhận
   END_VAR

   #tre.TON(IN := #DIEU_KIEN, PT := #T_TRE);
   #coDk := #tre.Q;
   #xn(CLK := #XAC_NHAN);
   #ack := #xn.Q;
   CASE #TRANG_THAI OF
      0:
         IF #coDk THEN #TRANG_THAI := 1; END_IF;
      1:
         IF #ack THEN
            #TRANG_THAI := 2;
         ELSIF NOT #coDk THEN
            #TRANG_THAI := 3;
         END_IF;
      2:
         IF NOT #coDk THEN #TRANG_THAI := 0; END_IF;
      3:
         IF #ack THEN
            #TRANG_THAI := 0;
         ELSIF #coDk THEN
            #TRANG_THAI := 1;
         END_IF;
   END_CASE;
   #NHAP_NHAY := (#TRANG_THAI = 1) OR (#TRANG_THAI = 3);
   #CO_CANH_BAO := (#TRANG_THAI = 1) OR (#TRANG_THAI = 2);
END_FUNCTION_BLOCK
