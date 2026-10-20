FUNCTION main : DINT
VAR
    fb : NoiSuyBang;
    tx : ARRAY[1..8] OF REAL := [0.0, 10.0, 20.0, 40.0, 0.0, 0.0, 0.0, 0.0];
    ty : ARRAY[1..8] OF REAL := [0.0, 100.0, 150.0, 350.0, 0.0, 0.0, 0.0, 0.0];
END_VAR
    fb(X := 5.0, BANG_X := tx, BANG_Y := ty, SO_DIEM := 4);
    KT_REAL('X 5 => 50', fb.Y, 50.0, 0.001);
    fb(X := 30.0);
    KT_REAL('X 30 => 250', fb.Y, 250.0, 0.001);
    fb(X := -5.0);
    KT_BOOL('X -5 => ngoai bang', fb.NGOAI_BANG, TRUE);
    main := KT_TONG();
END_FUNCTION
