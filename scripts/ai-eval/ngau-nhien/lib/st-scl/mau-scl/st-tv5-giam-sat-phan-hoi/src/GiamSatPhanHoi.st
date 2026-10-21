FUNCTION_BLOCK "GiamSatPhanHoi"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      LENH_CHAY : Bool;
      PHAN_HOI : Bool;
      T_CHO : Time;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      BAO_DONG : Bool;
      LOI_MAT_PHAN_HOI : Bool;
      LOI_PHAN_HOI_THUA : Bool;
   END_VAR

   VAR
      tonThua : TON_TIME;
      daCo : Bool;      // đã có phản hồi trong lần chạy hiện tại
   END_VAR

   VAR_TEMP
      dkMat : Bool;
      dkThua : Bool;
   END_VAR

BEGIN
   REGION Dieu kien loi
      #dkMat := #LENH_CHAY AND #daCo AND NOT #PHAN_HOI;
      #daCo := #LENH_CHAY AND (#daCo OR #PHAN_HOI);
      #tonThua(IN := #PHAN_HOI AND NOT #LENH_CHAY, PT := #T_CHO);
      #dkThua := #tonThua.Q;
   END_REGION

   REGION Chot loi
      IF #dkMat THEN
         #LOI_MAT_PHAN_HOI := TRUE;
      ELSIF #RESET THEN
         #LOI_MAT_PHAN_HOI := FALSE;
      END_IF;
      IF #dkThua THEN
         #LOI_PHAN_HOI_THUA := TRUE;
      ELSIF #RESET THEN
         #LOI_PHAN_HOI_THUA := FALSE;
      END_IF;
      #BAO_DONG := #LOI_MAT_PHAN_HOI OR #LOI_PHAN_HOI_THUA;
   END_REGION
END_FUNCTION_BLOCK
