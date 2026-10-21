FUNCTION_BLOCK "KhoaChuyenMach"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      YC_SAO : Bool;
      YC_TG : Bool;
   END_VAR

   VAR_OUTPUT
      KM_SAO : Bool;
      KM_TAM_GIAC : Bool;
   END_VAR

   VAR_TEMP
      saoMoi : Bool;
      tgMoi : Bool;
   END_VAR

   REGION Khoa lien dong
      (* Mỗi công tắc tơ chỉ đóng khi cái kia đã nhả từ chu kỳ trước *)
      #saoMoi := #YC_SAO AND NOT #YC_TG AND NOT #KM_TAM_GIAC;
      #tgMoi := #YC_TG AND NOT #YC_SAO AND NOT #KM_SAO;
      #KM_SAO := #saoMoi;
      #KM_TAM_GIAC := #tgMoi;
   END_REGION
END_FUNCTION_BLOCK
