TYPE
    ST_Axis : STRUCT
        Position : REAL;
        Velocity : REAL;
        Homed    : BOOL;
    END_STRUCT;
    ST_Cell : STRUCT
        AxisX : ST_Axis;
        AxisY : ST_Axis;
        Name  : STRING[32];
    END_STRUCT;
END_TYPE

PROGRAM CellStatus
VAR
    Cell     : ST_Cell;
    AllHomed : BOOL;
    Dist     : REAL;
END_VAR

AllHomed := Cell.AxisX.Homed AND Cell.AxisY.Homed;
Dist := SQRT(Cell.AxisX.Position * Cell.AxisX.Position + Cell.AxisY.Position ** 2.0);
Cell.Name := 'Cell A';

END_PROGRAM
