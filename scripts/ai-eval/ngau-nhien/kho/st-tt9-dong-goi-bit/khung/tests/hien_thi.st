FUNCTION main : DINT
VAR
    b : ARRAY[0..15] OF BOOL;
    m : MoGoiBit;
END_VAR
    b[0] := TRUE; b[2] := TRUE;
    KT_DINT('bit 0 va 2 => 5', WORD_TO_DINT(DongGoiBit(b)), 5);
    m(GIA_TRI := 16#0003);
    KT_BOOL('3 => BIT[1]', m.BIT[1], TRUE);
    KT_DINT('3 => hai bit 1', m.SO_BIT_1, 2);
    main := KT_TONG();
END_FUNCTION
