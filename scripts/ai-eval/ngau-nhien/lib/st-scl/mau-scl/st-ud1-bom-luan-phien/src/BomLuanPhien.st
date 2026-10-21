FUNCTION_BLOCK "BomLuanPhien"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      MUC_CAO : Bool;
      MUC_THAP : Bool;
      PH1 : Bool;
      PH2 : Bool;
      RESET : Bool;
      T_PHAN_HOI : Time;
   END_VAR

   VAR_OUTPUT
      BOM1 : Bool;
      BOM2 : Bool;
      CAN_BOM : Bool;
      LOI1 : Bool;
      LOI2 : Bool;
      BAO_DONG : Bool;
      BOM_CHINH : Int;
   END_VAR

   VAR
      gs1 : "GiamSatBom";
      gs2 : "GiamSatBom";
      canCu : Bool;
      dangChay : Int;  // 0 = không bơm nào, 1, 2
   END_VAR

   REGION 1. Nhu cau bom
      // phao thấp thắng; sườn lên của nhu cầu = khởi động mới => luân phiên
      IF #MUC_THAP THEN
         #CAN_BOM := FALSE;
      ELSIF #MUC_CAO THEN
         #CAN_BOM := TRUE;
      END_IF;
      IF #CAN_BOM AND NOT #canCu THEN
         IF #BOM_CHINH = 1 THEN #BOM_CHINH := 2; ELSE #BOM_CHINH := 1; END_IF;
      END_IF;
      #canCu := #CAN_BOM;
   END_REGION

   REGION 2. Chon bom theo LOI cua chu ky truoc
      IF NOT #CAN_BOM THEN
         #dangChay := 0;
      ELSIF #dangChay = 0 OR (#dangChay = 1 AND #LOI1) OR (#dangChay = 2 AND #LOI2) THEN
         IF #BOM_CHINH = 1 THEN
            IF NOT #LOI1 THEN #dangChay := 1; ELSIF NOT #LOI2 THEN #dangChay := 2; ELSE #dangChay := 0; END_IF;
         ELSE
            IF NOT #LOI2 THEN #dangChay := 2; ELSIF NOT #LOI1 THEN #dangChay := 1; ELSE #dangChay := 0; END_IF;
         END_IF;
      END_IF;
   END_REGION

   REGION 3. Giam sat phan hoi
      #gs1(LENH := (#dangChay = 1), PHAN_HOI := #PH1, RESET := #RESET, T_PHAN_HOI := #T_PHAN_HOI);
      #gs2(LENH := (#dangChay = 2), PHAN_HOI := #PH2, RESET := #RESET, T_PHAN_HOI := #T_PHAN_HOI);
      #LOI1 := #gs1.LOI;
      #LOI2 := #gs2.LOI;
   END_REGION

   REGION 4. Dau ra
      #BOM1 := #dangChay = 1 AND NOT #LOI1;
      #BOM2 := #dangChay = 2 AND NOT #LOI2;
      #BAO_DONG := #LOI1 AND #LOI2;
   END_REGION
END_FUNCTION_BLOCK
