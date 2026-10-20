(* Kịch bản PI: chu kỳ quét 10 ms, KP 2, TI 1 s, TS 100 ms (KP*TS/TI = 0.2), U trong [0, 100].
   Lần gọi đầu t = 10 tính ngay; sau đó tính ở t = 110, 210, ... (khi G_NOW - lần tính trước >= 100 ms).
   Mỗi lần gọi k chạy n chu kỳ với đầu vào cố định; đếm chu kỳ U ra ngoài [0, 100]. *)
FUNCTION_BLOCK KtCanhPI
VAR_INPUT
    sp, pv, utay : REAL;
    man : BOOL;
    n : INT;
END_VAR
VAR_OUTPUT
    fb : BoPI;
    vi : DINT;
END_VAR
VAR
    i : INT;
END_VAR
    FOR i := 1 TO n DO
        KT_BUOC(T#10ms);
        fb(SP := sp, PV := pv, KP := 2.0, TI := 1.0, TS := T#100ms, U_MIN := 0.0, U_MAX := 100.0, MAN := man, U_TAY := utay);
        IF fb.U < 0.0 OR fb.U > 100.0 OR (fb.BAO_HOA_CAO AND fb.BAO_HOA_THAP) THEN vi := vi + 1; END_IF
    END_FOR
END_FUNCTION_BLOCK

FUNCTION main : DINT
VAR
    k : KtCanhPI;
END_VAR
    k(sp := 50.0, pv := 40.0, utay := 0.0, man := FALSE, n := 1);   (* t = 10: e 10 => U 20, I 2 *)
    KT_REAL('10 U', k.fb.U, 20.0, 0.001);
    KT_REAL('10 I', k.fb.I_TP, 2.0, 0.001);
    k(pv := 45.0, n := 9);                     (* t = 20..100: chưa tới lần lấy mẫu => giữ *)
    KT_REAL('100 U giu', k.fb.U, 20.0, 0.001);
    KT_REAL('100 I giu', k.fb.I_TP, 2.0, 0.001);
    k(n := 1);                                 (* t = 110: e 5 => U 10 + 2 = 12, I 3 *)
    KT_REAL('110 U', k.fb.U, 12.0, 0.001);
    KT_REAL('110 I', k.fb.I_TP, 3.0, 0.001);
    k(n := 10);                                (* t = 210: U 10 + 3 = 13, I 4 *)
    KT_REAL('210 U', k.fb.U, 13.0, 0.001);
    KT_REAL('210 I', k.fb.I_TP, 4.0, 0.001);
    k(sp := 100.0, pv := 0.0, n := 10);        (* t = 310: e 100, u thô 204 > 100 => kẹp, không tích phân *)
    KT_REAL('310 U kep', k.fb.U, 100.0, 0.001);
    KT_BOOL('310 bao hoa cao', k.fb.BAO_HOA_CAO, TRUE);
    KT_REAL('310 I khong tang', k.fb.I_TP, 4.0, 0.001);
    k(n := 10);                                (* t = 410 *)
    KT_REAL('410 I van 4', k.fb.I_TP, 4.0, 0.001);
    k(sp := 50.0, pv := 48.0, n := 10);        (* t = 510: e 2 => U 4 + 4 = 8, I 4.4 *)
    KT_REAL('510 U', k.fb.U, 8.0, 0.001);
    KT_REAL('510 I', k.fb.I_TP, 4.4, 0.001);
    KT_BOOL('510 het bao hoa', k.fb.BAO_HOA_CAO, FALSE);
    k(sp := 0.0, pv := 50.0, n := 10);         (* t = 610: e -50, u thô -95.6 < 0 => kẹp 0, không tích phân *)
    KT_REAL('610 U kep duoi', k.fb.U, 0.0, 0.001);
    KT_BOOL('610 bao hoa thap', k.fb.BAO_HOA_THAP, TRUE);
    KT_REAL('610 I khong giam', k.fb.I_TP, 4.4, 0.001);
    (* Tay *)
    k(sp := 50.0, pv := 40.0, utay := 60.0, man := TRUE, n := 1);   (* t = 620: U 60, I = 60 - 2*10 = 40 *)
    KT_REAL('620 tay U', k.fb.U, 60.0, 0.001);
    KT_REAL('620 tay I bam', k.fb.I_TP, 40.0, 0.001);
    KT_BOOL('620 tay khong bao hoa', k.fb.BAO_HOA_THAP, FALSE);
    k(utay := 70.0, n := 3);                   (* t = 630..650: U 70, I 50 *)
    KT_REAL('650 tay U', k.fb.U, 70.0, 0.001);
    KT_REAL('650 tay I', k.fb.I_TP, 50.0, 0.001);
    k(man := FALSE, n := 1);                   (* t = 660: tự động, lần tay cuối 650 => chưa tính *)
    KT_REAL('660 U giu', k.fb.U, 70.0, 0.001);
    k(n := 8);                                 (* t = 670..740 *)
    KT_REAL('740 U giu', k.fb.U, 70.0, 0.001);
    k(n := 1);                                 (* t = 750: e 10 => U 20 + 50 = 70 (không giật), I 52 *)
    KT_REAL('750 bumpless U', k.fb.U, 70.0, 0.001);
    KT_REAL('750 I', k.fb.I_TP, 52.0, 0.001);
    k(pv := 60.0, utay := 100.0, man := TRUE, n := 1);   (* t = 760: e -10 => U 100, I = 100 + 20 = 120 *)
    KT_REAL('760 tay U', k.fb.U, 100.0, 0.001);
    KT_REAL('760 tay I', k.fb.I_TP, 120.0, 0.001);
    k(pv := 55.0, man := FALSE, n := 10);      (* t = 860: e -5, u thô 110 > 100 nhưng e < 0 => VẪN tích phân: I 119 *)
    KT_REAL('860 U kep', k.fb.U, 100.0, 0.001);
    KT_BOOL('860 bao hoa cao', k.fb.BAO_HOA_CAO, TRUE);
    KT_REAL('860 I rut ve', k.fb.I_TP, 119.0, 0.001);
    k(pv := 50.0, utay := 150.0, man := TRUE, n := 1);   (* t = 870: U_TAY kẹp 100, e 0 => I 100 *)
    KT_REAL('870 tay kep U', k.fb.U, 100.0, 0.001);
    KT_REAL('870 tay kep I', k.fb.I_TP, 100.0, 0.001);
    k(utay := -20.0, n := 1);                  (* t = 880 *)
    KT_REAL('880 tay kep duoi', k.fb.U, 0.0, 0.001);
    KT_DINT('bat bien U trong gioi han moi chu ky', k.vi, 0);
    KT_REAL('kep giua', KepGioiHan(X := 3.0, LO := 0.0, HI := 10.0), 3.0, 0.001);
    KT_REAL('kep duoi', KepGioiHan(X := -1.0, LO := 0.0, HI := 10.0), 0.0, 0.001);
    KT_REAL('kep tren 2.5', KepGioiHan(X := 5.0, LO := 0.0, HI := 2.5), 2.5, 0.001);
    main := KT_TONG();
END_FUNCTION
