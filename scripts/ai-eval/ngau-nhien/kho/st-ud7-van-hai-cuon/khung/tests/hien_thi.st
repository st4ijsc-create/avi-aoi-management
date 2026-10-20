FUNCTION main : DINT
VAR
    fb : VanHaiCuon;
END_VAR
    fb(CT_DONG := TRUE, T_HANH_TRINH := T#150ms);
    KT_DINT('dang dong san => DA_DONG', fb.TRANG_THAI, 4);
    KT_BUOC(T#10ms);
    fb(MO := TRUE);
    KT_DINT('lenh MO => DANG_MO', fb.TRANG_THAI, 1);
    KT_BOOL('lenh MO => cuon mo', fb.CUON_MO, TRUE);
    KT_DINT('vi tri giua', ViTriVan(CT_MO := FALSE, CT_DONG := FALSE), 0);
    main := KT_TONG();
END_FUNCTION
