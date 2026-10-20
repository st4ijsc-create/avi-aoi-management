FUNCTION main : DINT
VAR
    fb : BoPhieu2oo3;
    i : INT;
    (* Bảng tính TAY từ đề bài, thứ tự i = A + 2B + 4C *)
    mQ : ARRAY[0..7] OF BOOL := [FALSE, FALSE, FALSE, TRUE, FALSE, TRUE, TRUE, TRUE];
    mL : ARRAY[0..7] OF BOOL := [FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE];
    mK : ARRAY[0..7] OF DINT := [0, 1, 2, 3, 3, 2, 1, 0];
    a, b, c : BOOL;
END_VAR
    FOR i := 0 TO 7 DO
        a := (i MOD 2) = 1;
        b := ((i / 2) MOD 2) = 1;
        c := (i / 4) = 1;
        fb(A := a, B := b, C := c);
        KT_BOOL('bang Q', fb.Q, mQ[i]);
        KT_BOOL('bang LECH', fb.LECH, mL[i]);
        KT_DINT('bang KENH_LECH', fb.KENH_LECH, mK[i]);
    END_FOR
    (* LECH trong vòng trên: F,T,T,T,T,T,T,F ⇒ đúng MỘT sườn lên *)
    KT_DINT('dem sau bang = 1 suon', fb.DEM_LECH, 1);

    fb(A := FALSE, B := FALSE, C := FALSE, RESET := TRUE);
    fb(RESET := FALSE);
    (* chuỗi 100,000,010,000,111,011: LECH T,F,T,F,F,T ⇒ 3 sườn lên *)
    fb(A := TRUE, B := FALSE, C := FALSE);
    fb(A := FALSE, B := FALSE, C := FALSE);
    fb(A := FALSE, B := TRUE, C := FALSE);
    fb(A := FALSE, B := FALSE, C := FALSE);
    fb(A := TRUE, B := TRUE, C := TRUE);
    fb(A := FALSE, B := TRUE, C := TRUE);
    KT_DINT('dem 3 suon', fb.DEM_LECH, 3);

    (* RESET giữ TRUE trong khi LECH vẫn TRUE: 0, và nhả RESET khi LECH còn TRUE không phải sườn mới *)
    fb(A := FALSE, B := TRUE, C := TRUE, RESET := TRUE);
    KT_DINT('reset => 0', fb.DEM_LECH, 0);
    fb(A := TRUE, B := FALSE, C := FALSE, RESET := TRUE);
    KT_DINT('reset giu, lech doi kenh => van 0', fb.DEM_LECH, 0);
    fb(A := TRUE, B := FALSE, C := FALSE, RESET := FALSE);
    KT_DINT('nha reset khi LECH con TRUE => 0', fb.DEM_LECH, 0);
    fb(A := TRUE, B := TRUE, C := TRUE);
    fb(A := TRUE, B := TRUE, C := FALSE);
    KT_DINT('suon moi sau reset => 1', fb.DEM_LECH, 1);
    main := KT_TONG();
END_FUNCTION
