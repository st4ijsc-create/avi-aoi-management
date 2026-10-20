FUNCTION main : DINT
VAR
    fb : HaiChot;
END_VAR
    fb(DAT := TRUE, XOA := FALSE);
    KT_BOOL('dat => Q_SR', fb.Q_SR, TRUE);
    KT_BOOL('dat => Q_RS', fb.Q_RS, TRUE);
    fb(DAT := FALSE, XOA := TRUE);
    KT_BOOL('xoa => Q_SR FALSE', fb.Q_SR, FALSE);
    main := KT_TONG();
END_FUNCTION
