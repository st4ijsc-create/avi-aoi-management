FUNCTION main : DINT
VAR
    l : BOOL;
    v : INT;
    w : WORD;
END_VAR
    v := BcdSangInt(BCD := 16#1234, LOI => l);
    KT_DINT('16#1234 => 1234', v, 1234);
    w := IntSangBcd(GIA_TRI := 9876, LOI => l);
    KT_DINT('9876 => 16#9876', WORD_TO_DINT(w), 16#9876);
    v := BcdSangInt(BCD := 16#00F0, LOI => l);
    KT_BOOL('16#00F0 => LOI', l, TRUE);
    main := KT_TONG();
END_FUNCTION
