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
    (* TODO: cài đặt theo đề bài, dùng SR + RS *)
    Q_SR := DAT;
    Q_RS := DAT;
END_FUNCTION_BLOCK
