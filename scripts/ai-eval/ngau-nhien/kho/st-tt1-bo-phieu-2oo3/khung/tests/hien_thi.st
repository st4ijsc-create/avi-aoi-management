FUNCTION main : DINT
VAR
    fb : BoPhieu2oo3;
END_VAR
    fb(A := TRUE, B := TRUE, C := TRUE);
    KT_BOOL('ba kenh TRUE => Q', fb.Q, TRUE);
    fb(A := TRUE, B := TRUE, C := FALSE);
    KT_BOOL('110 => LECH', fb.LECH, TRUE);
    KT_DINT('110 => kenh lech 3', fb.KENH_LECH, 3);
    main := KT_TONG();
END_FUNCTION
