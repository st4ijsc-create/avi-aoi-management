FUNCTION main : DINT
VAR
    fb : DemGioChay;
    i : DINT;
END_VAR
    fb(DANG_CHAY := FALSE, RESET := FALSE);
    KT_DINT('ban dau 0', fb.GIAY_TONG, 0);
    (* chu kỳ 7ms: chu kỳ bắt đầu chạy không cộng, sau đó 9999 bước = 69,993 s *)
    KT_BUOC(T#7ms); fb(DANG_CHAY := TRUE);
    FOR i := 1 TO 9999 DO
        KT_BUOC(T#7ms); fb(DANG_CHAY := TRUE);
    END_FOR
    KT_DINT('9999 x 7ms = 69,993 s => 69', fb.GIAY_TONG, 69);
    (* bước thứ 10000: đúng 70,000 s — phần lẻ phải được giữ, không trôi *)
    KT_BUOC(T#7ms); fb(DANG_CHAY := TRUE);
    KT_DINT('10000 x 7ms = 70 s', fb.GIAY_TONG, 70);
    KT_DINT('70 s => PHUT 1', fb.PHUT, 1);
    KT_DINT('70 s => GIO 0', fb.GIO, 0);
    (* chu kỳ dừng không cộng; thời gian dừng không cộng *)
    KT_BUOC(T#7ms); fb(DANG_CHAY := FALSE);
    KT_DINT('chu ky dung khong cong', fb.GIAY_TONG, 70);
    KT_BUOC(T#10s); fb(DANG_CHAY := FALSE);
    KT_DINT('dang dung khong cong', fb.GIAY_TONG, 70);
    KT_BUOC(T#1s); fb(DANG_CHAY := TRUE);
    KT_DINT('chay lai: chu ky dau khong cong', fb.GIAY_TONG, 70);
    KT_BUOC(T#500ms); fb(DANG_CHAY := TRUE);
    KT_DINT('70,5 s => 70', fb.GIAY_TONG, 70);
    KT_BUOC(T#500ms); fb(DANG_CHAY := TRUE);
    KT_DINT('71 s', fb.GIAY_TONG, 71);
    (* bước lớn 1 h: 3671 s = 1 h 1 ph 11 s *)
    KT_BUOC(T#1h); fb(DANG_CHAY := TRUE);
    KT_DINT('3671 s', fb.GIAY_TONG, 3671);
    KT_DINT('3671 s => GIO 1', fb.GIO, 1);
    KT_DINT('3671 s => PHUT 1', fb.PHUT, 1);
    (* + 58 ph 59 s = 7210 s = 2 h 0 ph 10 s *)
    KT_BUOC(T#58m59s); fb(DANG_CHAY := TRUE);
    KT_DINT('7210 s', fb.GIAY_TONG, 7210);
    KT_DINT('7210 s => GIO 2', fb.GIO, 2);
    KT_DINT('7210 s => PHUT 0', fb.PHUT, 0);
    (* phần lẻ 0,3 s rồi RESET: RESET xoá cả phần lẻ *)
    KT_BUOC(T#300ms); fb(DANG_CHAY := TRUE);
    KT_DINT('7210,3 s => 7210', fb.GIAY_TONG, 7210);
    KT_BUOC(T#1s); fb(DANG_CHAY := TRUE, RESET := TRUE);
    KT_DINT('reset => 0', fb.GIAY_TONG, 0);
    KT_DINT('reset => GIO 0', fb.GIO, 0);
    KT_DINT('reset => PHUT 0', fb.PHUT, 0);
    (* chạy tiếp sau reset: cộng Δt kể từ chu kỳ reset *)
    KT_BUOC(T#700ms); fb(DANG_CHAY := TRUE, RESET := FALSE);
    KT_DINT('0,7 s sau reset => 0', fb.GIAY_TONG, 0);
    KT_BUOC(T#300ms); fb(DANG_CHAY := TRUE);
    KT_DINT('1,0 s sau reset => 1', fb.GIAY_TONG, 1);
    main := KT_TONG();
END_FUNCTION
