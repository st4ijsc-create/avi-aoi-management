FUNCTION main : DINT
VAR
    b : ARRAY[0..15] OF BOOL;
    i : INT;
    m : MoGoiBit;
END_VAR
    (* ĐÓNG GÓI: BIT[i] ⇒ bit i (trọng số 2^i) *)
    KT_DINT('D tat ca F => 0', WORD_TO_DINT(DongGoiBit(b)), 0);
    b[0] := TRUE;
    KT_DINT('D chi bit 0 => 1', WORD_TO_DINT(DongGoiBit(b)), 1);
    b[0] := FALSE; b[15] := TRUE;
    KT_DINT('D chi bit 15 => 8000', WORD_TO_DINT(DongGoiBit(b)), 16#8000);
    (* bit chẵn ⇒ 0101... = 16#5555 *)
    FOR i := 0 TO 15 DO
        b[i] := (i MOD 2) = 0;
    END_FOR
    KT_DINT('D bit chan => 5555', WORD_TO_DINT(DongGoiBit(b)), 16#5555);
    FOR i := 0 TO 15 DO
        b[i] := TRUE;
    END_FOR
    KT_DINT('D tat ca T => FFFF', WORD_TO_DINT(DongGoiBit(b)), 16#FFFF);
    FOR i := 0 TO 15 DO
        b[i] := (i MOD 4) = 0;
    END_FOR
    KT_DINT('D bit 0,4,8,12 => 1111', WORD_TO_DINT(DongGoiBit(b)), 16#1111);
    FOR i := 0 TO 15 DO
        b[i] := i >= 8;
    END_FOR
    KT_DINT('D byte cao => FF00', WORD_TO_DINT(DongGoiBit(b)), 16#FF00);

    (* MỞ GÓI — gọi liên tiếp CÙNG một FB *)
    m(GIA_TRI := 16#8001);
    KT_BOOL('M 8001 BIT0', m.BIT[0], TRUE);
    KT_BOOL('M 8001 BIT1', m.BIT[1], FALSE);
    KT_BOOL('M 8001 BIT15', m.BIT[15], TRUE);
    KT_DINT('M 8001 so bit 2', m.SO_BIT_1, 2);
    m(GIA_TRI := 16#FFFF);
    KT_BOOL('M FFFF BIT7', m.BIT[7], TRUE);
    KT_DINT('M FFFF so bit 16', m.SO_BIT_1, 16);
    m(GIA_TRI := 16#0000);
    KT_BOOL('M 0000 BIT0', m.BIT[0], FALSE);
    KT_BOOL('M 0000 BIT15', m.BIT[15], FALSE);
    KT_DINT('M 0000 so bit 0', m.SO_BIT_1, 0);
    m(GIA_TRI := 16#00F0);
    KT_BOOL('M 00F0 BIT3', m.BIT[3], FALSE);
    KT_BOOL('M 00F0 BIT4', m.BIT[4], TRUE);
    KT_BOOL('M 00F0 BIT7', m.BIT[7], TRUE);
    KT_BOOL('M 00F0 BIT8', m.BIT[8], FALSE);
    KT_DINT('M 00F0 so bit 4', m.SO_BIT_1, 4);
    (* khứ hồi: A5C3 = 1010 0101 1100 0011 ⇒ 8 bit 1 *)
    m(GIA_TRI := 16#A5C3);
    KT_DINT('M A5C3 so bit 8', m.SO_BIT_1, 8);
    KT_DINT('khu hoi A5C3', WORD_TO_DINT(DongGoiBit(m.BIT)), 16#A5C3);
    KT_BOOL('M A5C3 BIT14 F', m.BIT[14], FALSE);
    KT_BOOL('M A5C3 BIT13 T', m.BIT[13], TRUE);
    main := KT_TONG();
END_FUNCTION
