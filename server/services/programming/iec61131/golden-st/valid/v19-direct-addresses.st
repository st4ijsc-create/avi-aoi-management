PROGRAM IoMapping
VAR
    StartBtn AT %IX0.0 : BOOL;
    StopBtn  AT %IX0.1 : BOOL;
    Motor    AT %QX0.0 : BOOL;
    Speed    AT %IW0   : INT;
    SpeedOut AT %QW0   : INT;
END_VAR

Motor := StartBtn AND NOT StopBtn;
SpeedOut := Speed;
%QX0.1 := Motor;
%MW10 := Speed / 2;

END_PROGRAM
