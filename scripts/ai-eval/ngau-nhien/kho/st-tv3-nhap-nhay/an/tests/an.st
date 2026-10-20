FUNCTION main : DINT
VAR
    fb : NhapNhay;
END_VAR
    (* T_SANG = 30ms, T_TOI = 20ms, bước 10ms.
       BAT lên t = 10: sáng [10, 40), tối [40, 60), sáng [60, 90), tối [90, 110), sáng từ 110 *)
    fb(BAT := FALSE, T_SANG := T#30ms, T_TOI := T#20ms);
    KT_BOOL('t=0 tat', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=10 sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=30 con sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=40 toi', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=50 con toi', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=60 sang lai', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=80 con sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=90 toi lan 2', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=100 con toi', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=110 sang lan 3', fb.DEN, TRUE);
    (* tắt trong pha sáng *)
    KT_BUOC(T#10ms); fb(BAT := FALSE);
    KT_BOOL('t=120 BAT FALSE => tat ngay', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := FALSE);
    KT_BOOL('t=130 van tat', fb.DEN, FALSE);
    (* bật lại t = 140: sáng [140, 170), tối [170, 190) *)
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=140 bat lai sang ngay', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=160 pha sang du 30ms moi', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=170 toi', fb.DEN, FALSE);
    (* tắt trong pha tối, bật lại t = 190: phải bắt đầu từ pha SÁNG *)
    KT_BUOC(T#10ms); fb(BAT := FALSE);
    KT_BOOL('t=180 tat', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=190 bat lai tu pha sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=210 con sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=220 toi', fb.DEN, FALSE);
    (* đổi nhịp: T_SANG = 10ms, T_TOI = 10ms từ t = 230 (pha tối mốc 220) *)
    KT_BUOC(T#10ms); fb(BAT := TRUE, T_SANG := T#10ms, T_TOI := T#10ms);
    KT_BOOL('t=230 toi du 10ms => sang', fb.DEN, TRUE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=240 toi', fb.DEN, FALSE);
    KT_BUOC(T#10ms); fb(BAT := TRUE);
    KT_BOOL('t=250 sang', fb.DEN, TRUE);
    main := KT_TONG();
END_FUNCTION
