FUNCTION_BLOCK KhoaChuyenMach
VAR_INPUT
    YC_SAO : BOOL;
    YC_TG : BOOL;
END_VAR
VAR_OUTPUT
    KM_SAO : BOOL;
    KM_TAM_GIAC : BOOL;
END_VAR
VAR
    saoMoi : BOOL;
    tgMoi : BOOL;
END_VAR
    (* Mỗi công tắc tơ chỉ đóng khi cái kia đã nhả từ chu kỳ trước *)
    saoMoi := YC_SAO AND NOT YC_TG AND NOT KM_TAM_GIAC;
    tgMoi := YC_TG AND NOT YC_SAO AND NOT KM_SAO;
    KM_SAO := saoMoi;
    KM_TAM_GIAC := tgMoi;
END_FUNCTION_BLOCK
