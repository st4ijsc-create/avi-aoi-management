FUNCTION main : DINT
VAR
    fb : MayTronMe;
END_VAR
    fb(START := TRUE, MUC := 0.0, MUC_A := 20.0, MUC_B := 10.0, MUC_RONG := 1.0, T_TRON := T#100ms);
    KT_DINT('start => CAP_A', fb.TRANG_THAI, 1);
    KT_BOOL('start => VAN_A mo', fb.VAN_A, TRUE);
    KT_BOOL('start => motor tat', fb.MOTOR, FALSE);
    main := KT_TONG();
END_FUNCTION
