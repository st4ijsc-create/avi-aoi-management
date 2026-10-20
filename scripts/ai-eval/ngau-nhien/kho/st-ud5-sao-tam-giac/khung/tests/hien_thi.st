FUNCTION main : DINT
VAR
    fb : KhoiDongSaoTamGiac;
END_VAR
    fb(START := TRUE, T_SAO := T#200ms, T_KHE := T#50ms);
    KT_BOOL('start => KM_CHINH', fb.KM_CHINH, TRUE);
    KT_BOOL('start => KM_SAO', fb.KM_SAO, TRUE);
    KT_BOOL('start => KM_TAM_GIAC tat', fb.KM_TAM_GIAC, FALSE);
    main := KT_TONG();
END_FUNCTION
