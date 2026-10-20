(* ═══════════════════════════════════════════════════════════════════════════════════════════════
   kt.st — trợ giúp test cho bài ST của bộ NGẪU NHIÊN (Đợt 7.2). TỆP BẢO VỆ: lời giải không được sửa.
   Mỗi lời gọi KT_* là MỘT test: in `DAT <tên>` hoặc `TRUOT <tên> …`.
   Tệp test kết thúc bằng `main := KT_TONG();` (in `KT_TONG pass=N fail=M`, mã thoát = số test trượt).
   Đồng hồ giả: `G_NOW` (prelude của bộ chấm) — tệp test tăng bằng `KT_BUOC(T#10ms)`; TON/TOF/TP chạy theo nó.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ *)
VAR_GLOBAL
    KT_DAT : DINT;
    KT_TRUOT : DINT;
END_VAR

FUNCTION KT_BOOL : BOOL
VAR_INPUT
    ten : STRING[160];
    thuc : BOOL;
    mong : BOOL;
END_VAR
    IF thuc = mong THEN
        KT_DAT := KT_DAT + 1;
        printf('DAT %s$N', REF(ten));
    ELSE
        KT_TRUOT := KT_TRUOT + 1;
        printf('TRUOT %s thuc=%d mong=%d$N', REF(ten), BOOL_TO_DINT(thuc), BOOL_TO_DINT(mong));
    END_IF
    KT_BOOL := thuc = mong;
END_FUNCTION

FUNCTION KT_DINT : BOOL
VAR_INPUT
    ten : STRING[160];
    thuc : DINT;
    mong : DINT;
END_VAR
    IF thuc = mong THEN
        KT_DAT := KT_DAT + 1;
        printf('DAT %s$N', REF(ten));
    ELSE
        KT_TRUOT := KT_TRUOT + 1;
        printf('TRUOT %s thuc=%d mong=%d$N', REF(ten), thuc, mong);
    END_IF
    KT_DINT := thuc = mong;
END_FUNCTION

(* So số thực với sai số tuyệt đối `saiSo`. *)
FUNCTION KT_REAL : BOOL
VAR_INPUT
    ten : STRING[160];
    thuc : LREAL;
    mong : LREAL;
    saiSo : LREAL;
END_VAR
VAR
    lech : LREAL;
END_VAR
    lech := thuc - mong;
    IF lech < 0.0 THEN lech := -lech; END_IF
    IF lech <= saiSo THEN
        KT_DAT := KT_DAT + 1;
        printf('DAT %s$N', REF(ten));
        KT_REAL := TRUE;
    ELSE
        KT_TRUOT := KT_TRUOT + 1;
        printf('TRUOT %s thuc=%f mong=%f$N', REF(ten), thuc, mong);
        KT_REAL := FALSE;
    END_IF
END_FUNCTION

(* So TIME theo mili-giây. *)
FUNCTION KT_TIME : BOOL
VAR_INPUT
    ten : STRING[160];
    thuc : TIME;
    mong : TIME;
END_VAR
    IF thuc = mong THEN
        KT_DAT := KT_DAT + 1;
        printf('DAT %s$N', REF(ten));
    ELSE
        KT_TRUOT := KT_TRUOT + 1;
        printf('TRUOT %s thuc=%lldms mong=%lldms$N', REF(ten), TIME_TO_LINT(thuc) / 1000000, TIME_TO_LINT(mong) / 1000000);
    END_IF
    KT_TIME := thuc = mong;
END_FUNCTION

(* Tiến đồng hồ giả một bước. *)
FUNCTION KT_BUOC : BOOL
VAR_INPUT
    dt : TIME;
END_VAR
    G_NOW := G_NOW + dt;
    KT_BUOC := TRUE;
END_FUNCTION

FUNCTION KT_TONG : DINT
    printf('KT_TONG pass=%d fail=%d$N', KT_DAT, KT_TRUOT);
    KT_TONG := KT_TRUOT;
END_FUNCTION
