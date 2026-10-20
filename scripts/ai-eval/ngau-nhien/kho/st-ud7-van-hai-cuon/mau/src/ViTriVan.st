FUNCTION ViTriVan : INT
VAR_INPUT
    CT_MO : BOOL;
    CT_DONG : BOOL;
END_VAR
    IF CT_MO AND CT_DONG THEN
        ViTriVan := 3;
    ELSIF CT_MO THEN
        ViTriVan := 1;
    ELSIF CT_DONG THEN
        ViTriVan := 2;
    ELSE
        ViTriVan := 0;
    END_IF
END_FUNCTION
