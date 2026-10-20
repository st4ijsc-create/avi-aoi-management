FUNCTION_BLOCK DocTangGiam
VAR_INPUT
    DICH : REAL;
    TOC_DO_TANG : REAL;
    TOC_DO_GIAM : REAL;
    BAT : BOOL;
END_VAR
VAR_OUTPUT
    RA : REAL;
    DA_TOI : BOOL;
END_VAR
VAR
    batCu : BOOL;
    tCu : TIME;
    dt : REAL;
END_VAR
    IF NOT BAT THEN
        RA := DICH;
        batCu := FALSE;
    ELSE
        IF NOT batCu THEN
            dt := 0.0;
            batCu := TRUE;
        ELSE
            dt := LINT_TO_REAL(TIME_TO_LINT(G_NOW - tCu)) / 1.0E9;
        END_IF
        tCu := G_NOW;
        IF DICH > RA THEN
            RA := MIN(RA + TOC_DO_TANG * dt, DICH);
        ELSIF DICH < RA THEN
            RA := MAX(RA - TOC_DO_GIAM * dt, DICH);
        END_IF
    END_IF
    DA_TOI := RA = DICH;
END_FUNCTION_BLOCK
