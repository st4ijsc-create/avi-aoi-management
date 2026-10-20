FUNCTION main : DINT
VAR
    fb : TreTru;
    lanh : TreTru;
END_VAR
    fb(PV := 40.0, SP := 50.0, DAI := 4.0, CHE_DO_LAM_LANH := FALSE);
    KT_BOOL('suoi PV thap => bat', fb.Q, TRUE);
    fb(PV := 60.0);
    KT_BOOL('suoi PV cao => tat', fb.Q, FALSE);
    lanh(PV := 60.0, SP := 50.0, DAI := 4.0, CHE_DO_LAM_LANH := TRUE);
    KT_BOOL('lanh PV cao => bat', lanh.Q, TRUE);
    main := KT_TONG();
END_FUNCTION
