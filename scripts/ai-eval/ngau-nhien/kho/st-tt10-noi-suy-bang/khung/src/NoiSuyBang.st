FUNCTION_BLOCK NoiSuyBang
VAR_INPUT
    X : REAL;
    BANG_X : ARRAY[1..8] OF REAL;
    BANG_Y : ARRAY[1..8] OF REAL;
    SO_DIEM : INT;
END_VAR
VAR_OUTPUT
    Y : REAL;
    LOI : BOOL;
    NGOAI_BANG : BOOL;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    Y := 0.0;
END_FUNCTION_BLOCK
