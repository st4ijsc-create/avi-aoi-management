FUNCTION main : DINT
VAR
    fb : BoPI;
END_VAR
    KT_BUOC(T#10ms);
    fb(SP := 50.0, PV := 40.0, KP := 2.0, TI := 1.0, TS := T#100ms, U_MIN := 0.0, U_MAX := 100.0);
    (* e = 10: U = 2*10 + 0 = 20; I = 0 + 2*0.1/1*10 = 2 *)
    KT_REAL('lan dau U = 20', fb.U, 20.0, 0.001);
    KT_REAL('lan dau I = 2', fb.I_TP, 2.0, 0.001);
    KT_REAL('kep tren', KepGioiHan(X := 150.0, LO := 0.0, HI := 100.0), 100.0, 0.001);
    main := KT_TONG();
END_FUNCTION
