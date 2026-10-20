FUNCTION DongGoiBit : WORD
VAR_INPUT
    BIT : ARRAY[0..15] OF BOOL;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    DongGoiBit := 0;
END_FUNCTION

FUNCTION_BLOCK MoGoiBit
VAR_INPUT
    GIA_TRI : WORD;
END_VAR
VAR_OUTPUT
    BIT : ARRAY[0..15] OF BOOL;
    SO_BIT_1 : INT;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    SO_BIT_1 := 0;
END_FUNCTION_BLOCK
