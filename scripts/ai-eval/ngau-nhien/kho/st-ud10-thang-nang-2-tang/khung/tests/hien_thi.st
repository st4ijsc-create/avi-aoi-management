FUNCTION main : DINT
VAR
    fb : ThangNang2Tang;
END_VAR
    fb(CT_TANG_1 := TRUE, CUA_DONG := TRUE, T_DI_CHUYEN := T#150ms);
    KT_DINT('o tang 1', fb.TANG, 1);
    KT_BUOC(T#10ms);
    fb(GOI_2 := TRUE);
    KT_DINT('goi tang 2 => di len', fb.TRANG_THAI, 1);
    KT_BOOL('goi tang 2 => LEN', fb.LEN, TRUE);
    main := KT_TONG();
END_FUNCTION
