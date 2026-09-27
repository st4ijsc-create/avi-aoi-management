FUNCTION_BLOCK FB_Accumulate
VAR_INPUT
    Add    : REAL;
    Enable : BOOL;
END_VAR
VAR_IN_OUT
    Total : REAL;
END_VAR
VAR_OUTPUT
    Overflow : BOOL;
END_VAR
VAR_TEMP
    Tmp : REAL;
END_VAR
VAR CONSTANT
    LIMIT_MAX : REAL := 1.0E6;
END_VAR
    IF Enable THEN
        Tmp := Total + Add;
        Overflow := Tmp > LIMIT_MAX;
        IF NOT Overflow THEN
            Total := Tmp;
        END_IF;
    END_IF;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    Acc     : FB_Accumulate;
    Energy  : REAL;
    Alarm   : BOOL;
END_VAR
    Acc(Add := 0.5, Enable := TRUE, Total := Energy);
    Alarm := Acc.Overflow;
END_PROGRAM
