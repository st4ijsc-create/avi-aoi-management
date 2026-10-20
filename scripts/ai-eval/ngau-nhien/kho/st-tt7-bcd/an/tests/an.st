FUNCTION main : DINT
VAR
    l : BOOL;
    v : INT;
    w : WORD;
END_VAR
    (* BCD ⇒ INT: mỗi nibble một chữ số thập phân, nibble > 9 ⇒ LOI, trả 0 *)
    v := BcdSangInt(BCD := 16#0000, LOI => l);
    KT_DINT('B 0000 gia tri', v, 0);
    KT_BOOL('B 0000 LOI F', l, FALSE);
    v := BcdSangInt(BCD := 16#9999, LOI => l);
    KT_DINT('B 9999', v, 9999);
    KT_BOOL('B 9999 LOI F', l, FALSE);
    v := BcdSangInt(BCD := 16#0042, LOI => l);
    KT_DINT('B 0042', v, 42);
    v := BcdSangInt(BCD := 16#1000, LOI => l);
    KT_DINT('B 1000', v, 1000);
    v := BcdSangInt(BCD := 16#0909, LOI => l);
    KT_DINT('B 0909', v, 909);
    (* nibble A (=10) ở hàng đơn vị *)
    v := BcdSangInt(BCD := 16#000A, LOI => l);
    KT_BOOL('B 000A LOI', l, TRUE);
    KT_DINT('B 000A tra 0', v, 0);
    (* hợp lệ sau lỗi ⇒ LOI xoá *)
    v := BcdSangInt(BCD := 16#0005, LOI => l);
    KT_BOOL('B sau loi LOI F', l, FALSE);
    KT_DINT('B 0005', v, 5);
    v := BcdSangInt(BCD := 16#A000, LOI => l);
    KT_BOOL('B A000 LOI', l, TRUE);
    KT_DINT('B A000 tra 0', v, 0);
    v := BcdSangInt(BCD := 16#12F4, LOI => l);
    KT_BOOL('B 12F4 LOI', l, TRUE);
    KT_DINT('B 12F4 tra 0', v, 0);
    v := BcdSangInt(BCD := 16#FFFF, LOI => l);
    KT_BOOL('B FFFF LOI', l, TRUE);

    (* INT ⇒ BCD: 0..9999, ngoài ⇒ LOI, trả 0 *)
    w := IntSangBcd(GIA_TRI := 0, LOI => l);
    KT_DINT('I 0', WORD_TO_DINT(w), 0);
    KT_BOOL('I 0 LOI F', l, FALSE);
    w := IntSangBcd(GIA_TRI := 9999, LOI => l);
    KT_DINT('I 9999', WORD_TO_DINT(w), 16#9999);
    w := IntSangBcd(GIA_TRI := 1, LOI => l);
    KT_DINT('I 1', WORD_TO_DINT(w), 16#0001);
    w := IntSangBcd(GIA_TRI := 1050, LOI => l);
    KT_DINT('I 1050', WORD_TO_DINT(w), 16#1050);
    w := IntSangBcd(GIA_TRI := 10000, LOI => l);
    KT_BOOL('I 10000 LOI', l, TRUE);
    KT_DINT('I 10000 tra 0', WORD_TO_DINT(w), 0);
    w := IntSangBcd(GIA_TRI := 807, LOI => l);
    KT_BOOL('I sau loi LOI F', l, FALSE);
    KT_DINT('I 807', WORD_TO_DINT(w), 16#0807);
    w := IntSangBcd(GIA_TRI := -1, LOI => l);
    KT_BOOL('I -1 LOI', l, TRUE);
    KT_DINT('I -1 tra 0', WORD_TO_DINT(w), 0);
    w := IntSangBcd(GIA_TRI := 32767, LOI => l);
    KT_BOOL('I 32767 LOI', l, TRUE);
    w := IntSangBcd(GIA_TRI := -32768, LOI => l);
    KT_BOOL('I -32768 LOI', l, TRUE);
    KT_DINT('I -32768 tra 0', WORD_TO_DINT(w), 0);
    main := KT_TONG();
END_FUNCTION
