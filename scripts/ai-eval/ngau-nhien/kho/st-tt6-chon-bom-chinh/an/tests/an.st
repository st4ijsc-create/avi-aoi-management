FUNCTION main : DINT
VAR
    fb : ChonBomChinh;
    g : ARRAY[1..4] OF UDINT;
    s : ARRAY[1..4] OF BOOL;
END_VAR
    (* A: giờ 500,200,300,100, cả 4 sẵn sàng ⇒ tăng dần: 4(100),2(200),3(300),1(500) *)
    g[1] := 500; g[2] := 200; g[3] := 300; g[4] := 100;
    s[1] := TRUE; s[2] := TRUE; s[3] := TRUE; s[4] := TRUE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('A BOM', fb.BOM, 4);
    KT_DINT('A TT1', fb.THU_TU[1], 4);
    KT_DINT('A TT2', fb.THU_TU[2], 2);
    KT_DINT('A TT3', fb.THU_TU[3], 3);
    KT_DINT('A TT4', fb.THU_TU[4], 1);
    (* B: bơm 4 không sẵn sàng ⇒ 2,3,1, ô thừa 0 (gọi lại cùng FB: không còn dư số cũ) *)
    s[4] := FALSE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('B BOM', fb.BOM, 2);
    KT_DINT('B TT1', fb.THU_TU[1], 2);
    KT_DINT('B TT2', fb.THU_TU[2], 3);
    KT_DINT('B TT3', fb.THU_TU[3], 1);
    KT_DINT('B TT4 = 0', fb.THU_TU[4], 0);
    (* C: không bơm nào sẵn sàng *)
    s[1] := FALSE; s[2] := FALSE; s[3] := FALSE; s[4] := FALSE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('C BOM 0', fb.BOM, 0);
    KT_DINT('C TT1 0', fb.THU_TU[1], 0);
    KT_DINT('C TT4 0', fb.THU_TU[4], 0);
    (* D: hoà 100,100,50,100 ⇒ 3, rồi 1,2,4 theo chỉ số *)
    g[1] := 100; g[2] := 100; g[3] := 50; g[4] := 100;
    s[1] := TRUE; s[2] := TRUE; s[3] := TRUE; s[4] := TRUE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('D BOM', fb.BOM, 3);
    KT_DINT('D TT1', fb.THU_TU[1], 3);
    KT_DINT('D TT2', fb.THU_TU[2], 1);
    KT_DINT('D TT3', fb.THU_TU[3], 2);
    KT_DINT('D TT4', fb.THU_TU[4], 4);
    (* E: tất cả 7 giờ, chỉ 2 và 4 sẵn sàng ⇒ 2,4,0,0 *)
    g[1] := 7; g[2] := 7; g[3] := 7; g[4] := 7;
    s[1] := FALSE; s[2] := TRUE; s[3] := FALSE; s[4] := TRUE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('E BOM', fb.BOM, 2);
    KT_DINT('E TT1', fb.THU_TU[1], 2);
    KT_DINT('E TT2', fb.THU_TU[2], 4);
    KT_DINT('E TT3 0', fb.THU_TU[3], 0);
    (* F: UDINT lớn (> 2^31): 4000000000, 3999999999, 0 (không sẵn sàng), 4294967295 ⇒ 2,1,4 *)
    g[1] := 4000000000; g[2] := 3999999999; g[3] := 0; g[4] := 4294967295;
    s[1] := TRUE; s[2] := TRUE; s[3] := FALSE; s[4] := TRUE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('F BOM', fb.BOM, 2);
    KT_DINT('F TT1', fb.THU_TU[1], 2);
    KT_DINT('F TT2', fb.THU_TU[2], 1);
    KT_DINT('F TT3', fb.THU_TU[3], 4);
    KT_DINT('F TT4 0', fb.THU_TU[4], 0);
    (* G: chỉ bơm 3 sẵn sàng *)
    s[1] := FALSE; s[2] := FALSE; s[3] := TRUE; s[4] := FALSE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('G BOM', fb.BOM, 3);
    KT_DINT('G TT1', fb.THU_TU[1], 3);
    KT_DINT('G TT2 0', fb.THU_TU[2], 0);
    (* H: hoà ở cuối 9,5,9,5 ⇒ 2,4,1,3 *)
    g[1] := 9; g[2] := 5; g[3] := 9; g[4] := 5;
    s[1] := TRUE; s[2] := TRUE; s[3] := TRUE; s[4] := TRUE;
    fb(GIO_CHAY := g, SAN_SANG := s);
    KT_DINT('H BOM', fb.BOM, 2);
    KT_DINT('H TT2', fb.THU_TU[2], 4);
    KT_DINT('H TT3', fb.THU_TU[3], 1);
    KT_DINT('H TT4', fb.THU_TU[4], 3);
    main := KT_TONG();
END_FUNCTION
