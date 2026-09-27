PROGRAM StringsAndBits
VAR
    Status  : WORD;
    Ready   : BOOL;
    Msg     : STRING(80);
    Prefix  : STRING := 'Line';
    Grid    : ARRAY[1..3, 1..4] OF INT;
    MsgLen  : INT;
    R, C    : INT;
END_VAR

Ready := Status.3;
Status.0 := TRUE;
Msg := CONCAT(Prefix, ' 1 ready');
MsgLen := LEN(Msg);
FOR R := 1 TO 3 DO
    FOR C := 1 TO 4 DO
        Grid[R, C] := R * 10 + C;
    END_FOR;
END_FOR;

END_PROGRAM
