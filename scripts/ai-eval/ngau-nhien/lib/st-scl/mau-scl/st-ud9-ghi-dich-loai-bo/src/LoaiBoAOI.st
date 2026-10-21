FUNCTION_BLOCK "LoaiBoAOI"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      ENCODER : Bool;
      CO_SAN_PHAM : Bool;
      LOI_AOI : Bool;
      RESET : Bool;
      VI_TRI_GAT : Int;
      T_GAT : Time;
   END_VAR

   VAR_OUTPUT
      CAN_GAT : Bool;
      DEM_GAT : DInt;
      SO_O_LOI : Int;
   END_VAR

   VAR
      rtEnc : R_TRIG;
      tg : "ThanhGhiDich";
      xungGat : TP_TIME;
   END_VAR

   VAR_TEMP
      toi : Bool;
   END_VAR

   REGION Dich thanh ghi theo encoder
      #rtEnc(CLK := #ENCODER);
      #tg(DICH := #rtEnc.Q AND NOT #RESET, GHI := #CO_SAN_PHAM AND #LOI_AOI AND NOT #RESET, XOA := #RESET, VI_TRI := #VI_TRI_GAT);
      // sản phẩm lỗi vừa được dịch tới vị trí gạt
      #toi := #rtEnc.Q AND NOT #RESET AND #VI_TRI_GAT >= 1 AND #VI_TRI_GAT <= 32 AND #tg.Q;
   END_REGION

   REGION Dem va gat
      IF #RESET THEN
         #DEM_GAT := 0;
      ELSIF #toi THEN
         #DEM_GAT := #DEM_GAT + 1;
      END_IF;
      #xungGat(IN := #toi, PT := #T_GAT);
      #CAN_GAT := #xungGat.Q;
      #SO_O_LOI := #tg.SO_O;
   END_REGION
END_FUNCTION_BLOCK
