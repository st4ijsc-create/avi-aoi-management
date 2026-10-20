FUNCTION main : DINT
VAR
    fb : ChonBomChinh;
    g : ARRAY[1..4] OF UDINT := [500, 200, 300, 100];
    s : ARRAY[1..4] OF BOOL := [TRUE, TRUE, TRUE, TRUE];
END_VAR
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('bom it gio nhat = 4', fb.BOM, 4);
    KT_DINT('thu tu 1 = 4', fb.THU_TU[1], 4);
    KT_DINT('thu tu 4 = 1', fb.THU_TU[4], 1);
    main := KT_TONG();
END_FUNCTION
