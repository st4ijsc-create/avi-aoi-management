(* =====================================================================
   PRELUDE do pipeline chay-st TIEM VAO moi lan bien dich (RuSTy).
   - Khai bao C printf/puts de harness in ket qua.
   - Dong ho MO PHONG G_NOW: harness tu tang moi chu ky (vd +T#10ms).
   - TON / TOF / TP thay the bo dinh thi chuan (timers.st cua stdlib
     KHONG duoc nap) => ket qua tat dinh, khong phu thuoc dong ho that.
   Ung vien KHONG duoc tu dinh nghia TON/TOF/TP/G_NOW/printf/puts.
   ===================================================================== *)
{external}
FUNCTION printf : DINT
VAR_INPUT {ref}
    format : STRING;
END_VAR
VAR_INPUT
    args : ...;
END_VAR
END_FUNCTION

{external}
FUNCTION puts : DINT
VAR_INPUT {ref}
    text : STRING;
END_VAR
END_FUNCTION

VAR_GLOBAL
    G_NOW : TIME;   (* dong ho mo phong, harness tang moi chu ky *)
END_VAR

(* On-delay: Q len TRUE khi IN giu TRUE lien tuc >= PT *)
FUNCTION_BLOCK TON
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; dangChay : BOOL; END_VAR
    IF NOT IN THEN
        dangChay := FALSE; Q := FALSE; ET := T#0s;
    ELSE
        IF NOT dangChay THEN dangChay := TRUE; t0 := G_NOW; END_IF
        ET := G_NOW - t0;
        IF ET >= PT THEN ET := PT; Q := TRUE; ELSE Q := FALSE; END_IF
    END_IF
END_FUNCTION_BLOCK

(* Off-delay: Q = TRUE ngay khi IN; giu TRUE them PT sau suon xuong *)
FUNCTION_BLOCK TOF
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; dangDem : BOOL; END_VAR
    IF IN THEN
        dangDem := FALSE; Q := TRUE; ET := T#0s;
    ELSIF Q THEN
        IF NOT dangDem THEN dangDem := TRUE; t0 := G_NOW; END_IF
        ET := G_NOW - t0;
        IF ET >= PT THEN ET := PT; Q := FALSE; dangDem := FALSE; END_IF
    END_IF
END_FUNCTION_BLOCK

(* Pulse: suon len IN => Q = TRUE dung PT, khong tai kich khi dang xung *)
FUNCTION_BLOCK TP
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; inCu : BOOL; END_VAR
    IF NOT Q AND IN AND NOT inCu THEN
        Q := TRUE; t0 := G_NOW;
    END_IF
    IF Q THEN
        ET := G_NOW - t0;
        IF ET >= PT THEN ET := PT; Q := FALSE; END_IF
    ELSIF NOT IN THEN
        ET := T#0s;
    END_IF
    inCu := IN;
END_FUNCTION_BLOCK
