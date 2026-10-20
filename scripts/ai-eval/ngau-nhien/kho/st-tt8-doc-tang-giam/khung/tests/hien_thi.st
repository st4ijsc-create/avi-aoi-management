FUNCTION main : DINT
VAR
    fb : DocTangGiam;
END_VAR
    (* t = 0: BAT tắt ⇒ bám theo đích *)
    fb(DICH := 20.0, TOC_DO_TANG := 10.0, TOC_DO_GIAM := 5.0, BAT := FALSE);
    KT_REAL('BAT tat => RA = DICH', fb.RA, 20.0, 0.001);
    (* t = 100 ms: BAT lên, chu kỳ đầu chỉ ghi thời điểm *)
    KT_BUOC(T#100ms);
    fb(DICH := 30.0, BAT := TRUE);
    KT_REAL('chu ky dau dt = 0', fb.RA, 20.0, 0.001);
    (* t = 200 ms: +10/s × 0.1 s = +1 *)
    KT_BUOC(T#100ms);
    fb();
    KT_REAL('sau 100ms => 21', fb.RA, 21.0, 0.001);
    main := KT_TONG();
END_FUNCTION
