(* Ban chep TON/TOF/TP cua prelude RuSTy (prelude-dong-ho-gia.st) cho MATIEC, ten KT_TON/KT_TOF/KT_TP — CHI dung o che do
   dongHo "gia" (tach khac biet trinh dich khoi khac biet ngu nghia bo dinh thi chuan cua MATIEC/OpenPLC). *)
FUNCTION_BLOCK KT_TON
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; dangChay : BOOL; END_VAR
    IF NOT IN THEN
        dangChay := FALSE; Q := FALSE; ET := T#0s;
    ELSE
        IF NOT dangChay THEN dangChay := TRUE; t0 := KT_NOW(FALSE); END_IF;
        ET := KT_NOW(FALSE) - t0;
        IF ET >= PT THEN ET := PT; Q := TRUE; ELSE Q := FALSE; END_IF;
    END_IF;
END_FUNCTION_BLOCK

FUNCTION_BLOCK KT_TOF
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; dangDem : BOOL; END_VAR
    IF IN THEN
        dangDem := FALSE; Q := TRUE; ET := T#0s;
    ELSIF Q THEN
        IF NOT dangDem THEN dangDem := TRUE; t0 := KT_NOW(FALSE); END_IF;
        ET := KT_NOW(FALSE) - t0;
        IF ET >= PT THEN ET := PT; Q := FALSE; dangDem := FALSE; END_IF;
    END_IF;
END_FUNCTION_BLOCK

FUNCTION_BLOCK KT_TP
VAR_INPUT  IN : BOOL; PT : TIME; END_VAR
VAR_OUTPUT Q : BOOL; ET : TIME; END_VAR
VAR t0 : TIME; inCu : BOOL; END_VAR
    IF NOT Q AND IN AND NOT inCu THEN
        Q := TRUE; t0 := KT_NOW(FALSE);
    END_IF;
    IF Q THEN
        ET := KT_NOW(FALSE) - t0;
        IF ET >= PT THEN ET := PT; Q := FALSE; END_IF;
    ELSIF NOT IN THEN
        ET := T#0s;
    END_IF;
    inCu := IN;
END_FUNCTION_BLOCK
