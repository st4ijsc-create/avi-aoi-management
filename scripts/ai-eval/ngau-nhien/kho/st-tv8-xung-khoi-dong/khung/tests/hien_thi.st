FUNCTION main : DINT
VAR
    fb : XungKhoiDong;
END_VAR
    (* T_XUNG = 50ms; nhấn t = 10 ⇒ xung [10, 60) *)
    fb(NUT := FALSE, T_XUNG := T#50ms, KHOA := FALSE);
    KT_BUOC(T#10ms); fb(NUT := TRUE);
    KT_BOOL('nhan => xung', fb.XUNG, TRUE);
    KT_DINT('so lan 1', fb.SO_LAN, 1);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BUOC(T#10ms); fb(NUT := FALSE);
    KT_BOOL('t=60 het xung', fb.XUNG, FALSE);
    main := KT_TONG();
END_FUNCTION
