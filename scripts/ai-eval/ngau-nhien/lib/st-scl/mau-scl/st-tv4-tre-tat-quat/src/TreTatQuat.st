FUNCTION_BLOCK "TreTatQuat"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      LENH : Bool;
      DUNG_KHAN : Bool;
      T_CHAY_THEM : Time;
   END_VAR

   VAR_OUTPUT
      QUAT : Bool;
      CON_LAI : Time;
   END_VAR

   VAR
      tre : TOF_TIME;
      huy : Bool;    // chạy thêm đã bị DUNG_KHAN hủy
   END_VAR

   VAR_TEMP
      chay : Bool;
   END_VAR

   REGION Lenh chay va huy
      #chay := #LENH AND NOT #DUNG_KHAN;
      IF #DUNG_KHAN THEN
         #huy := TRUE;
      ELSIF #chay THEN
         #huy := FALSE;
      END_IF;
   END_REGION

   REGION Tre tat
      #tre(IN := #chay, PT := #T_CHAY_THEM);
      #QUAT := #tre.Q AND NOT #huy;
      IF #QUAT AND NOT #chay THEN
         #CON_LAI := #T_CHAY_THEM - #tre.ET;
      ELSE
         #CON_LAI := T#0s;
      END_IF;
   END_REGION
END_FUNCTION_BLOCK
