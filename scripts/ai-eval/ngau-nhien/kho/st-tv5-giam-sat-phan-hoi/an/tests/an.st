FUNCTION main : DINT
VAR
    fb : GiamSatPhanHoi;
    i : INT;
END_VAR
    (* T_CHO = 40ms, bước 10ms *)
    fb(LENH_CHAY := FALSE, PHAN_HOI := FALSE, T_CHO := T#40ms, RESET := FALSE);
    KT_BOOL('t=0 khong loi', fb.BAO_DONG, FALSE);
    (* có lệnh, chưa có phản hồi t = 10..50: không phải lỗi nào trong đề *)
    FOR i := 1 TO 5 DO
        KT_BUOC(T#10ms); fb(LENH_CHAY := TRUE, PHAN_HOI := FALSE);
    END_FOR
    KT_BOOL('t=50 chua co phan hoi => khong MAT', fb.LOI_MAT_PHAN_HOI, FALSE);
    KT_BOOL('t=50 khong bao dong', fb.BAO_DONG, FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BOOL('t=60 co phan hoi', fb.BAO_DONG, FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE);
    KT_BOOL('t=70 mat => MAT', fb.LOI_MAT_PHAN_HOI, TRUE);
    KT_BOOL('t=70 bao dong', fb.BAO_DONG, TRUE);
    KT_BOOL('t=70 khong THUA', fb.LOI_PHAN_HOI_THUA, FALSE);
    (* RESET khi điều kiện còn (vẫn lệnh, vẫn mất) => không xoá *)
    KT_BUOC(T#10ms); fb(RESET := TRUE);
    KT_BOOL('t=80 reset khi dk con => giu', fb.LOI_MAT_PHAN_HOI, TRUE);
    (* phản hồi trở lại: lỗi vẫn CHỐT *)
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE, RESET := FALSE);
    KT_BOOL('t=90 phan hoi lai van chot', fb.LOI_MAT_PHAN_HOI, TRUE);
    KT_BUOC(T#10ms); fb(RESET := TRUE);
    KT_BOOL('t=100 reset khi het dk => xoa', fb.LOI_MAT_PHAN_HOI, FALSE);
    KT_BOOL('t=100 bao dong xoa', fb.BAO_DONG, FALSE);
    KT_BUOC(T#10ms); fb(RESET := FALSE);
    (* mất lần nữa rồi bỏ lệnh: điều kiện hết => RESET xoá được *)
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE);
    KT_BOOL('t=120 mat lan 2', fb.LOI_MAT_PHAN_HOI, TRUE);
    KT_BUOC(T#10ms); fb(LENH_CHAY := FALSE);
    KT_BOOL('t=130 bo lenh, chua reset => giu', fb.LOI_MAT_PHAN_HOI, TRUE);
    KT_BUOC(T#10ms); fb(RESET := TRUE);
    KT_BOOL('t=140 reset sau bo lenh => xoa', fb.LOI_MAT_PHAN_HOI, FALSE);
    (* phản hồi thừa: không lệnh, phản hồi từ t = 150 (mốc 150) => lỗi tại t = 190 *)
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE, RESET := FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BOOL('t=180 thua 30ms chua loi', fb.LOI_PHAN_HOI_THUA, FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BOOL('t=190 thua 40ms => loi', fb.LOI_PHAN_HOI_THUA, TRUE);
    KT_BOOL('t=190 bao dong', fb.BAO_DONG, TRUE);
    KT_BOOL('t=190 khong MAT', fb.LOI_MAT_PHAN_HOI, FALSE);
    KT_BUOC(T#10ms); fb(RESET := TRUE);
    KT_BOOL('t=200 reset khi con thua => giu', fb.LOI_PHAN_HOI_THUA, TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE, RESET := FALSE);
    KT_BOOL('t=210 het phan hoi van chot', fb.LOI_PHAN_HOI_THUA, TRUE);
    KT_BUOC(T#10ms); fb(RESET := TRUE);
    KT_BOOL('t=220 reset => xoa thua', fb.LOI_PHAN_HOI_THUA, FALSE);
    KT_BOOL('t=220 bao dong xoa', fb.BAO_DONG, FALSE);
    (* phản hồi thừa ngắn 30ms: bỏ qua *)
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE, RESET := FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE);
    KT_BOOL('t=270 thua ngan => khong loi', fb.BAO_DONG, FALSE);
    (* dừng có quán tính: lệnh t = 280 có phản hồi; bỏ lệnh t = 290, phản hồi còn t = 290..310 *)
    KT_BUOC(T#10ms); fb(LENH_CHAY := TRUE, PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(LENH_CHAY := FALSE, PHAN_HOI := TRUE);
    KT_BOOL('t=290 bo lenh con phan hoi => khong MAT', fb.LOI_MAT_PHAN_HOI, FALSE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := TRUE);
    KT_BUOC(T#10ms); fb(PHAN_HOI := FALSE);
    KT_BOOL('t=320 quan tinh 30ms => khong loi', fb.BAO_DONG, FALSE);
    (* chạy lại t = 330 mà chưa có phản hồi: "đã có" của lần chạy trước KHÔNG còn *)
    KT_BUOC(T#10ms); fb(LENH_CHAY := TRUE, PHAN_HOI := FALSE);
    KT_BOOL('t=330 lan chay moi chua co => khong MAT', fb.LOI_MAT_PHAN_HOI, FALSE);
    KT_BUOC(T#10ms); fb(LENH_CHAY := TRUE, PHAN_HOI := FALSE);
    KT_BOOL('t=340 van khong MAT', fb.BAO_DONG, FALSE);
    main := KT_TONG();
END_FUNCTION
