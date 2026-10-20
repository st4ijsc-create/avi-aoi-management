FUNCTION main : DINT
VAR
    fb : HaiChot;
    i : INT;
    (* chuỗi vào và kỳ vọng tính TAY:
       SR: Q = DAT OR (NOT XOA AND Q_cũ)   — đặt thắng
       RS: Q = NOT XOA AND (DAT OR Q_cũ)   — xoá thắng
       bước:  1    2    3    4    5    6    7    8    9    10   11   12
       DAT :  0    1    0    1    0    0    1    0    1    1    0    0
       XOA :  0    0    0    1    0    1    1    1    1    0    0    1
       Q_SR:  0    1    1    1    1    0    1    0    1    1    1    0
       Q_RS:  0    1    1    0    0    0    0    0    0    1    1    0
       DOI :  0    1    1    1    1    2    3    4    5    5    5    6 *)
    vDat : ARRAY[1..12] OF BOOL := [FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, TRUE, FALSE, TRUE, TRUE, FALSE, FALSE];
    vXoa : ARRAY[1..12] OF BOOL := [FALSE, FALSE, FALSE, TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, TRUE];
    mSr : ARRAY[1..12] OF BOOL := [FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, TRUE, TRUE, TRUE, FALSE];
    mRs : ARRAY[1..12] OF BOOL := [FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE];
    mDoi : ARRAY[1..12] OF DINT := [0, 1, 1, 1, 1, 2, 3, 4, 5, 5, 5, 6];
END_VAR
    FOR i := 1 TO 12 DO
        fb(DAT := vDat[i], XOA := vXoa[i]);
        KT_BOOL('chuoi Q_SR', fb.Q_SR, mSr[i]);
        KT_BOOL('chuoi Q_RS', fb.Q_RS, mRs[i]);
        KT_DINT('chuoi DOI_TRANG_THAI', fb.DOI_TRANG_THAI, mDoi[i]);
    END_FOR
    main := KT_TONG();
END_FUNCTION
