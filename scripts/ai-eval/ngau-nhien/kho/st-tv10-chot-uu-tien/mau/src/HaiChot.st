FUNCTION_BLOCK HaiChot
VAR_INPUT
    DAT : BOOL;
    XOA : BOOL;
END_VAR
VAR_OUTPUT
    Q_SR : BOOL;
    Q_RS : BOOL;
    DOI_TRANG_THAI : UDINT;
END_VAR
VAR
    chotSR : SR;
    chotRS : RS;
    qSrCu : BOOL;
END_VAR
    chotSR(SET1 := DAT, RESET := XOA);
    chotRS(SET := DAT, RESET1 := XOA);
    Q_SR := chotSR.Q1;
    Q_RS := chotRS.Q1;
    IF Q_SR <> qSrCu THEN
        DOI_TRANG_THAI := DOI_TRANG_THAI + 1;
    END_IF
    qSrCu := Q_SR;
END_FUNCTION_BLOCK
