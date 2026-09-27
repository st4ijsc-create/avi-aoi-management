FUNCTION_BLOCK FB_Clamp
VAR_INPUT
    In   : REAL;
    Lo   : REAL := 0.0;
    Hi   : REAL := 100.0;
END_VAR
VAR_OUTPUT
    Out     : REAL;
    Clipped : BOOL;
    Rounded : INT;
END_VAR
    Out := LIMIT(Lo, In, Hi);
    Clipped := Out <> In;
    Rounded := REAL_TO_INT(Out);
    Rounded := TRUNC(Out);
    Out := MAX(Out, INT_TO_REAL(Rounded));
END_FUNCTION_BLOCK

PROGRAM UseClamp
VAR
    Clamp : FB_Clamp;
    Raw   : REAL;
    Value : REAL;
    Warn  : BOOL;
END_VAR
    Clamp(In := Raw, Hi := 80.0, Out => Value, Clipped => Warn);
END_PROGRAM
