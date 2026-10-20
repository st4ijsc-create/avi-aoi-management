FUNCTION BcdSangInt : INT
VAR_INPUT
    BCD : WORD;
END_VAR
VAR_OUTPUT
    LOI : BOOL;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    LOI := FALSE;
    BcdSangInt := 0;
END_FUNCTION

FUNCTION IntSangBcd : WORD
VAR_INPUT
    GIA_TRI : INT;
END_VAR
VAR_OUTPUT
    LOI : BOOL;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    LOI := FALSE;
    IntSangBcd := 0;
END_FUNCTION
