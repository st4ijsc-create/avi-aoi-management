FUNCTION_BLOCK MayTronMe
VAR_INPUT
    START : BOOL;
    STOP : BOOL;
    MUC : REAL;
    MUC_A : REAL;
    MUC_B : REAL;
    MUC_RONG : REAL;
    T_TRON : TIME;
END_VAR
VAR_OUTPUT
    VAN_A : BOOL;
    VAN_B : BOOL;
    VAN_XA : BOOL;
    MOTOR : BOOL;
    TRANG_THAI : INT;
    SO_ME : DINT;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    VAN_A := FALSE;
END_FUNCTION_BLOCK
