FUNCTION main : DINT
VAR
    fb : ChongDoi;
    fb0 : ChongDoi;
    i : INT;
END_VAR
    (* T_BAT = 50ms, T_TAT = 30ms, mỗi bước 10ms. t = 0: IN = FALSE *)
    fb(IN := FALSE, T_BAT := T#50ms, T_TAT := T#30ms);
    KT_BOOL('t=0 Q = FALSE', fb.Q, FALSE);
    (* xung ngắn: IN = TRUE t = 10..40 (mốc 10, giữ tối đa 30ms) *)
    FOR i := 1 TO 4 DO
        KT_BUOC(T#10ms); fb(IN := TRUE);
    END_FOR
    KT_BOOL('t=40 xung 30ms chua len', fb.Q, FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=50 xung ngan bi bo qua', fb.Q, FALSE);
    (* IN = TRUE từ t = 60 (mốc MỚI 60, xung trước không cộng dồn) *)
    FOR i := 1 TO 5 DO
        KT_BUOC(T#10ms); fb(IN := TRUE);
    END_FOR
    KT_BOOL('t=100 giu 40ms chua len', fb.Q, FALSE);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=110 giu 50ms len', fb.Q, TRUE);
    (* IN = FALSE t = 120, 130 (20ms < 30ms) rồi TRUE t = 140 *)
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=120 vua tha => van TRUE', fb.Q, TRUE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=130 tha 10ms => van TRUE', fb.Q, TRUE);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=140 nhieu ngan bi bo qua', fb.Q, TRUE);
    (* IN = FALSE từ t = 150 (mốc 150): xuống tại t = 180 *)
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=170 tha 20ms van TRUE', fb.Q, TRUE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=180 tha 30ms xuong', fb.Q, FALSE);
    (* nhiễu bật một chu kỳ t = 190 *)
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=190 nhieu bat 1 chu ky', fb.Q, FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=200 van FALSE', fb.Q, FALSE);
    (* IN = TRUE t = 210..260: lên tại t = 260 *)
    FOR i := 1 TO 5 DO
        KT_BUOC(T#10ms); fb(IN := TRUE);
    END_FOR
    KT_BOOL('t=250 chua len', fb.Q, FALSE);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=260 len', fb.Q, TRUE);
    (* FALSE t = 270, 280; TRUE t = 290; FALSE từ t = 300 (mốc mới 300) ⇒ xuống tại t = 330 *)
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=320 moc tat dem lai tu 300', fb.Q, TRUE);
    KT_BUOC(T#10ms); fb(IN := FALSE);
    KT_BOOL('t=330 xuong', fb.Q, FALSE);
    (* đổi tham số khi đang chạy: T_BAT = 20ms; TRUE từ t = 340 ⇒ lên tại t = 360 *)
    KT_BUOC(T#10ms); fb(IN := TRUE, T_BAT := T#20ms);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=350 T_BAT 20ms chua len', fb.Q, FALSE);
    KT_BUOC(T#10ms); fb(IN := TRUE);
    KT_BOOL('t=360 T_BAT 20ms len', fb.Q, TRUE);

    (* T_BAT = T_TAT = 0: Q theo IN ngay trong cùng chu kỳ *)
    fb0(IN := FALSE, T_BAT := T#0ms, T_TAT := T#0ms);
    KT_BOOL('T=0 ban dau FALSE', fb0.Q, FALSE);
    KT_BUOC(T#10ms); fb0(IN := TRUE);
    KT_BOOL('T_BAT=0 len ngay', fb0.Q, TRUE);
    KT_BUOC(T#10ms); fb0(IN := FALSE);
    KT_BOOL('T_TAT=0 xuong ngay', fb0.Q, FALSE);
    main := KT_TONG();
END_FUNCTION
