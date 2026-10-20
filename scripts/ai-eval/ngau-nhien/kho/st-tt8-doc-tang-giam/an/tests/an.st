FUNCTION main : DINT
VAR
    fb : DocTangGiam;
    f2 : DocTangGiam;
END_VAR
    (* TANG 10/s, GIAM 5/s *)
    (* t = 0: BAT tắt *)
    fb(DICH := 20.0, TOC_DO_TANG := 10.0, TOC_DO_GIAM := 5.0, BAT := FALSE);
    KT_REAL('t0 RA 20', fb.RA, 20.0, 0.001);
    KT_BOOL('t0 DA_TOI', fb.DA_TOI, TRUE);
    (* t = 100: BAT lên, đích 25, chu kỳ đầu Δt = 0 *)
    KT_BUOC(T#100ms);
    fb(DICH := 25.0, BAT := TRUE);
    KT_REAL('t100 RA giu 20', fb.RA, 20.0, 0.001);
    KT_BOOL('t100 chua toi', fb.DA_TOI, FALSE);
    (* t = 200: +1 ⇒ 21 *)
    KT_BUOC(T#100ms);
    fb();
    KT_REAL('t200 RA 21', fb.RA, 21.0, 0.001);
    (* t = 300: 22 *)
    KT_BUOC(T#100ms);
    fb();
    KT_REAL('t300 RA 22', fb.RA, 22.0, 0.001);
    (* t = 500: Δt 200 ms ⇒ +2 ⇒ 24 *)
    KT_BUOC(T#200ms);
    fb();
    KT_REAL('t500 RA 24', fb.RA, 24.0, 0.001);
    KT_BOOL('t500 chua toi', fb.DA_TOI, FALSE);
    (* t = 650: +1.5 ⇒ 25.5 vượt đích ⇒ đúng 25 *)
    KT_BUOC(T#150ms);
    fb();
    KT_REAL('t650 kep 25', fb.RA, 25.0, 0.0001);
    KT_BOOL('t650 DA_TOI', fb.DA_TOI, TRUE);
    (* t = 750: đích 10 ⇒ giảm 5/s × 0.1 = 0.5 ⇒ 24.5 *)
    KT_BUOC(T#100ms);
    fb(DICH := 10.0);
    KT_REAL('t750 giam 24.5', fb.RA, 24.5, 0.001);
    KT_BOOL('t750 chua toi', fb.DA_TOI, FALSE);
    (* t = 1750: −5 ⇒ 19.5 *)
    KT_BUOC(T#1000ms);
    fb();
    KT_REAL('t1750 RA 19.5', fb.RA, 19.5, 0.001);
    (* t = 3750: −10 ⇒ 9.5 dưới đích ⇒ 10 *)
    KT_BUOC(T#2000ms);
    fb();
    KT_REAL('t3750 kep 10', fb.RA, 10.0, 0.0001);
    KT_BOOL('t3750 DA_TOI', fb.DA_TOI, TRUE);
    (* cùng t: BAT tắt, đích 50 ⇒ bám ngay *)
    fb(DICH := 50.0, BAT := FALSE);
    KT_REAL('BAT tat bam 50', fb.RA, 50.0, 0.001);
    KT_BOOL('BAT tat DA_TOI', fb.DA_TOI, TRUE);
    (* t = 8750 (sau 5 s tắt): BAT lên, đích 60 ⇒ chu kỳ đầu Δt = 0, không dùng khoảng 5 s *)
    KT_BUOC(T#5000ms);
    fb(DICH := 60.0, BAT := TRUE);
    KT_REAL('bat lai chu ky dau giu 50', fb.RA, 50.0, 0.001);
    KT_BOOL('bat lai chua toi', fb.DA_TOI, FALSE);
    (* t = 8850: 51 *)
    KT_BUOC(T#100ms);
    fb();
    KT_REAL('t8850 RA 51', fb.RA, 51.0, 0.001);
    (* gọi lại cùng thời điểm ⇒ Δt = 0 *)
    fb();
    KT_REAL('cung thoi diem giu 51', fb.RA, 51.0, 0.001);
    (* t = 8950: đích 0 ⇒ 51 − 0.5 = 50.5 *)
    KT_BUOC(T#100ms);
    fb(DICH := 0.0);
    KT_REAL('dao chieu 50.5', fb.RA, 50.5, 0.001);

    (* FB mới, lần gọi đầu đã BAT: RA ban đầu 0, Δt = 0 *)
    f2(DICH := 5.0, TOC_DO_TANG := 1.0, TOC_DO_GIAM := 1.0, BAT := TRUE);
    KT_REAL('f2 dau RA 0', f2.RA, 0.0, 0.0001);
    KT_BOOL('f2 dau chua toi', f2.DA_TOI, FALSE);
    KT_BUOC(T#1000ms);
    f2();
    KT_REAL('f2 sau 1s RA 1', f2.RA, 1.0, 0.001);
    KT_BUOC(T#10000ms);
    f2();
    KT_REAL('f2 sau 11s kep 5', f2.RA, 5.0, 0.0001);
    KT_BOOL('f2 DA_TOI', f2.DA_TOI, TRUE);
    main := KT_TONG();
END_FUNCTION
