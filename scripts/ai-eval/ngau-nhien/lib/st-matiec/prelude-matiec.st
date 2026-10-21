(* =====================================================================
   PRELUDE MATIEC / OpenPLC do bo cham TIEM VAO (thay tests/kt.st + prelude RuSTy).
   - KT_* : cung ten, cung thu tu tham so, cung dong in (DAT/TRUOT/KT_TONG)
     nhu kt.st cua RuSTy; dem bang bien C (main.c) qua pragma {{ }}.
   - Dong ho: __CURRENT_TIME cua runtime MATIEC (bien C OpenPLC dung cho
     TON/TOF/TP CHUAN). KT_BUOC tang no; G_NOW trong ma duoc bo cham doi
     thanh KT_NOW(FALSE) (MATIEC khong co VAR_GLOBAL ngoai CONFIGURATION).
   - Ham phai co it nhat MOT khai bao bien (MATIEC: ham khong khai bao
     lam hong phan tich cac POU sau) => tham so gia boQua.
   ===================================================================== *)
FUNCTION KT_NOW : TIME
VAR_INPUT boQua : BOOL; END_VAR
    {{ KT_NOW = __CURRENT_TIME; }}
END_FUNCTION

(* Bo cham doi KT_DINT/KT_REAL/KT_TIME/KT_BOOL cua tep test thanh KT_XET(ten, <phep so>) — MATIEC khong noi kieu doi so. *)
FUNCTION KT_XET : BOOL
VAR_INPUT ten : STRING; dat : BOOL; END_VAR
    KT_XET := dat;
    IF dat THEN
        {{ extern long kt_dat; kt_dat++; printf("DAT %.*s\n", (int)TEN.len, (char*)TEN.body); }}
    ELSE
        {{ extern long kt_truot; kt_truot++; printf("TRUOT %.*s (matiec: khong in gia tri)\n", (int)TEN.len, (char*)TEN.body); }}
    END_IF;
END_FUNCTION

FUNCTION KT_BOOL : BOOL
VAR_INPUT ten : STRING; thuc : BOOL; mong : BOOL; END_VAR
    KT_BOOL := thuc = mong;
    IF thuc = mong THEN
        {{ extern long kt_dat; kt_dat++; printf("DAT %.*s\n", (int)TEN.len, (char*)TEN.body); }}
    ELSE
        {{ extern long kt_truot; kt_truot++; printf("TRUOT %.*s thuc=%d mong=%d\n", (int)TEN.len, (char*)TEN.body, (int)THUC, (int)MONG); }}
    END_IF;
END_FUNCTION

FUNCTION KT_DINT : BOOL
VAR_INPUT ten : STRING; thuc : DINT; mong : DINT; END_VAR
    KT_DINT := thuc = mong;
    IF thuc = mong THEN
        {{ extern long kt_dat; kt_dat++; printf("DAT %.*s\n", (int)TEN.len, (char*)TEN.body); }}
    ELSE
        {{ extern long kt_truot; kt_truot++; printf("TRUOT %.*s thuc=%d mong=%d\n", (int)TEN.len, (char*)TEN.body, (int)THUC, (int)MONG); }}
    END_IF;
END_FUNCTION

(* So so thuc voi sai so tuyet doi saiSo. *)
FUNCTION KT_REAL : BOOL
VAR_INPUT ten : STRING; thuc : LREAL; mong : LREAL; saiSo : LREAL; END_VAR
VAR lech : LREAL; END_VAR
    lech := thuc - mong;
    IF lech < 0.0 THEN lech := -lech; END_IF;
    KT_REAL := lech <= saiSo;
    IF lech <= saiSo THEN
        {{ extern long kt_dat; kt_dat++; printf("DAT %.*s\n", (int)TEN.len, (char*)TEN.body); }}
    ELSE
        {{ extern long kt_truot; kt_truot++; printf("TRUOT %.*s thuc=%f mong=%f\n", (int)TEN.len, (char*)TEN.body, (double)THUC, (double)MONG); }}
    END_IF;
END_FUNCTION

(* So TIME theo mili-giay. *)
FUNCTION KT_TIME : BOOL
VAR_INPUT ten : STRING; thuc : TIME; mong : TIME; END_VAR
    KT_TIME := thuc = mong;
    IF thuc = mong THEN
        {{ extern long kt_dat; kt_dat++; printf("DAT %.*s\n", (int)TEN.len, (char*)TEN.body); }}
    ELSE
        {{ extern long kt_truot; kt_truot++; printf("TRUOT %.*s thuc=%lldms mong=%lldms\n", (int)TEN.len, (char*)TEN.body,
             (long long)THUC.tv_sec * 1000 + THUC.tv_nsec / 1000000, (long long)MONG.tv_sec * 1000 + MONG.tv_nsec / 1000000); }}
    END_IF;
END_FUNCTION

(* Tien dong ho mot buoc. *)
FUNCTION KT_BUOC : BOOL
VAR_INPUT buoc : TIME; END_VAR
    {{ __CURRENT_TIME = __time_add(__CURRENT_TIME, BUOC); }}
    KT_BUOC := TRUE;
END_FUNCTION

FUNCTION KT_TONG : DINT
VAR_INPUT boQua : BOOL; END_VAR
    {{ extern long kt_dat, kt_truot; printf("KT_TONG pass=%ld fail=%ld\n", kt_dat, kt_truot); KT_TONG = kt_truot; }}
END_FUNCTION

(* De bai plc-st-v1 hua TIME = so nguyen NANO giay (TIME_TO_LINT(T#1s) = 1000000000, nhu RuSTy); TIME_TO_LINT cua
   MATIEC tra MILI giay. Bo cham doi TIME_TO_LINT( / LINT_TO_TIME( trong ma thanh hai ham duoi (giu loi hua cua de). *)
FUNCTION KT_TIME_TO_LINT : LINT
VAR_INPUT t : TIME; END_VAR
    {{ KT_TIME_TO_LINT = (LINT)T.tv_sec * 1000000000LL + (LINT)T.tv_nsec; }}
END_FUNCTION

FUNCTION KT_LINT_TO_TIME : TIME
VAR_INPUT ns : LINT; END_VAR
    {{ KT_LINT_TO_TIME.tv_sec = (long)(NS / 1000000000LL); KT_LINT_TO_TIME.tv_nsec = (long)(NS % 1000000000LL);
       if (KT_LINT_TO_TIME.tv_nsec < 0) { KT_LINT_TO_TIME.tv_nsec += 1000000000L; KT_LINT_TO_TIME.tv_sec -= 1; } }}
END_FUNCTION
