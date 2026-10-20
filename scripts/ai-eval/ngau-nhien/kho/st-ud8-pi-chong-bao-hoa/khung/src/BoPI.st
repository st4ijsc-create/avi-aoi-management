FUNCTION_BLOCK BoPI
VAR_INPUT
    SP : REAL;
    PV : REAL;
    KP : REAL;
    TI : REAL;
    TS : TIME;
    U_MIN : REAL;
    U_MAX : REAL;
    MAN : BOOL;
    U_TAY : REAL;
END_VAR
VAR_OUTPUT
    U : REAL;
    I_TP : REAL;
    BAO_HOA_CAO : BOOL;
    BAO_HOA_THAP : BOOL;
END_VAR
    (* TODO: cài đặt theo đề bài *)
    U := 0.0;
END_FUNCTION_BLOCK
