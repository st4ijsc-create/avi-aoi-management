FUNCTION main : DINT
VAR
    fb : NoiSuyBang;
    tx : ARRAY[1..8] OF REAL;
    ty : ARRAY[1..8] OF REAL;
    i : INT;
END_VAR
    (* Bảng 1: X 0,10,20,40 — Y 0,100,150,350 (độ dốc 10, 5, 10); ô 5..8 là rác GIẢM dần *)
    tx[1] := 0.0; tx[2] := 10.0; tx[3] := 20.0; tx[4] := 40.0;
    ty[1] := 0.0; ty[2] := 100.0; ty[3] := 150.0; ty[4] := 350.0;
    tx[5] := 5.0; tx[6] := 3.0; tx[7] := 1.0; tx[8] := 0.0;
    fb(X := 5.0, BANG_X := tx, BANG_Y := ty, SO_DIEM := 4);
    KT_BOOL('rac sau SO_DIEM khong LOI', fb.LOI, FALSE);
    KT_REAL('X 5 => 50', fb.Y, 50.0, 0.001);
    fb(X := 10.0);
    KT_REAL('X 10 diem giua => 100', fb.Y, 100.0, 0.001);
    fb(X := 15.0);
    KT_REAL('X 15 => 125', fb.Y, 125.0, 0.001);
    fb(X := 30.0);
    KT_REAL('X 30 => 250', fb.Y, 250.0, 0.001);
    KT_BOOL('X 30 trong bang', fb.NGOAI_BANG, FALSE);
    fb(X := 40.0);
    KT_REAL('X 40 bien phai => 350', fb.Y, 350.0, 0.001);
    KT_BOOL('X 40 khong ngoai', fb.NGOAI_BANG, FALSE);
    fb(X := 0.0);
    KT_REAL('X 0 bien trai => 0', fb.Y, 0.0, 0.001);
    KT_BOOL('X 0 khong ngoai', fb.NGOAI_BANG, FALSE);
    fb(X := -5.0);
    KT_REAL('X -5 kep Y1', fb.Y, 0.0, 0.001);
    KT_BOOL('X -5 ngoai', fb.NGOAI_BANG, TRUE);
    fb(X := 50.0);
    KT_REAL('X 50 kep Y4', fb.Y, 350.0, 0.001);
    KT_BOOL('X 50 ngoai', fb.NGOAI_BANG, TRUE);
    (* chỉ 2 điểm đầu: X 20 > X2 = 10 ⇒ Y2 = 100, ngoài bảng; X 2.5 ⇒ 25 *)
    fb(X := 20.0, SO_DIEM := 2);
    KT_REAL('2 diem X 20 kep 100', fb.Y, 100.0, 0.001);
    KT_BOOL('2 diem X 20 ngoai', fb.NGOAI_BANG, TRUE);
    fb(X := 2.5);
    KT_REAL('2 diem X 2.5 => 25', fb.Y, 25.0, 0.001);
    (* SO_DIEM ngoài 2..8 *)
    fb(X := 5.0, SO_DIEM := 1);
    KT_BOOL('SO_DIEM 1 LOI', fb.LOI, TRUE);
    KT_REAL('SO_DIEM 1 Y 0', fb.Y, 0.0, 0.0001);
    fb(SO_DIEM := 9);
    KT_BOOL('SO_DIEM 9 LOI', fb.LOI, TRUE);
    fb(SO_DIEM := 0);
    KT_BOOL('SO_DIEM 0 LOI', fb.LOI, TRUE);
    (* trùng X: 0,10,10,20 ⇒ không tăng nghiêm ngặt ⇒ LOI, Y 0, NGOAI_BANG F kể cả X ngoài *)
    tx[3] := 10.0; tx[4] := 20.0;
    fb(X := 100.0, BANG_X := tx, SO_DIEM := 4);
    KT_BOOL('trung X LOI', fb.LOI, TRUE);
    KT_REAL('trung X Y 0', fb.Y, 0.0, 0.0001);
    KT_BOOL('trung X NGOAI F', fb.NGOAI_BANG, FALSE);
    (* giảm: 0,10,5,20 *)
    tx[3] := 5.0;
    fb(X := 3.0, BANG_X := tx);
    KT_BOOL('X giam LOI', fb.LOI, TRUE);
    (* hồi phục: 0,10,20,40 *)
    tx[3] := 20.0; tx[4] := 40.0;
    fb(X := 15.0, BANG_X := tx);
    KT_BOOL('hoi phuc LOI F', fb.LOI, FALSE);
    KT_REAL('hoi phuc X 15 => 125', fb.Y, 125.0, 0.001);
    (* độ dốc âm/dương: X -10,0,10 — Y 5,-5,20 *)
    tx[1] := -10.0; tx[2] := 0.0; tx[3] := 10.0;
    ty[1] := 5.0; ty[2] := -5.0; ty[3] := 20.0;
    fb(X := -5.0, BANG_X := tx, BANG_Y := ty, SO_DIEM := 3);
    KT_REAL('doc am X -5 => 0', fb.Y, 0.0, 0.001);
    fb(X := 4.0);
    KT_REAL('X 4 => -5 + 4*2.5 = 5', fb.Y, 5.0, 0.001);
    (* đủ 8 điểm: X = i, Y = i*i *)
    FOR i := 1 TO 8 DO
        tx[i] := INT_TO_REAL(i);
        ty[i] := INT_TO_REAL(i * i);
    END_FOR
    fb(X := 7.5, BANG_X := tx, BANG_Y := ty, SO_DIEM := 8);
    KT_REAL('8 diem X 7.5 => 56.5', fb.Y, 56.5, 0.001);
    fb(X := 8.0);
    KT_REAL('8 diem X 8 => 64', fb.Y, 64.0, 0.001);
    KT_BOOL('8 diem X 8 khong ngoai', fb.NGOAI_BANG, FALSE);
    fb(X := 1.5);
    KT_REAL('8 diem X 1.5 => 2.5', fb.Y, 2.5, 0.001);
    main := KT_TONG();
END_FUNCTION
