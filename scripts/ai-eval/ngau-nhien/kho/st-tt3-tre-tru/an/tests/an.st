FUNCTION main : DINT
VAR
    s : TreTru;
    l : TreTru;
    s0 : TreTru;
    sAm : TreTru;
    l0 : TreTru;
    sSp : TreTru;
END_VAR
    (* SƯỞI, SP 50, DAI 4 ⇒ ngưỡng bật 48, ngưỡng tắt 52 *)
    s(PV := 50.0, SP := 50.0, DAI := 4.0, CHE_DO_LAM_LANH := FALSE);
    KT_BOOL('suoi ban dau giua => F', s.Q, FALSE);
    s(PV := 49.0);
    KT_BOOL('suoi 49 giu F', s.Q, FALSE);
    s(PV := 48.0);
    KT_BOOL('suoi 48 = nguong bat => T', s.Q, TRUE);
    s(PV := 51.0);
    KT_BOOL('suoi 51 giu T', s.Q, TRUE);
    s(PV := 51.99);
    KT_BOOL('suoi 51.99 giu T', s.Q, TRUE);
    s(PV := 52.0);
    KT_BOOL('suoi 52 = nguong tat => F', s.Q, FALSE);
    s(PV := 49.0);
    KT_BOOL('suoi 49 giu F lan 2', s.Q, FALSE);
    s(PV := 30.0);
    KT_BOOL('suoi 30 => T', s.Q, TRUE);

    (* LÀM LẠNH, SP 50, DAI 4 ⇒ bật khi >= 52, tắt khi <= 48 *)
    l(PV := 50.0, SP := 50.0, DAI := 4.0, CHE_DO_LAM_LANH := TRUE);
    KT_BOOL('lanh ban dau giua => F', l.Q, FALSE);
    l(PV := 52.0);
    KT_BOOL('lanh 52 => T', l.Q, TRUE);
    l(PV := 49.0);
    KT_BOOL('lanh 49 giu T', l.Q, TRUE);
    l(PV := 48.0);
    KT_BOOL('lanh 48 => F', l.Q, FALSE);
    l(PV := 51.0);
    KT_BOOL('lanh 51 giu F', l.Q, FALSE);

    (* SƯỞI DAI 0, SP 20: PV = SP ⇒ cả hai điều kiện đúng ⇒ TẮT thắng *)
    s0(PV := 19.9, SP := 20.0, DAI := 0.0, CHE_DO_LAM_LANH := FALSE);
    KT_BOOL('dai0 19.9 => T', s0.Q, TRUE);
    s0(PV := 20.0);
    KT_BOOL('dai0 PV=SP => tat thang F', s0.Q, FALSE);
    s0(PV := 19.99);
    KT_BOOL('dai0 19.99 => T', s0.Q, TRUE);

    (* DAI âm ⇒ coi như 0, SP 20 *)
    sAm(PV := 19.0, SP := 20.0, DAI := -10.0, CHE_DO_LAM_LANH := FALSE);
    KT_BOOL('dai am 19 => T', sAm.Q, TRUE);
    sAm(PV := 20.5);
    KT_BOOL('dai am 20.5 => F', sAm.Q, FALSE);
    sAm(PV := 19.5);
    KT_BOOL('dai am 19.5 => T', sAm.Q, TRUE);

    (* LÀM LẠNH DAI 0, SP 20 *)
    l0(PV := 20.0, SP := 20.0, DAI := 0.0, CHE_DO_LAM_LANH := TRUE);
    KT_BOOL('lanh dai0 PV=SP => F', l0.Q, FALSE);
    l0(PV := 20.1);
    KT_BOOL('lanh dai0 20.1 => T', l0.Q, TRUE);
    l0(PV := 20.0);
    KT_BOOL('lanh dai0 ve SP => F', l0.Q, FALSE);

    (* SP đổi khi chạy: PV 47 ⇒ bật; SP 40 ⇒ ngưỡng tắt 42 ⇒ tắt *)
    sSp(PV := 47.0, SP := 50.0, DAI := 4.0, CHE_DO_LAM_LANH := FALSE);
    KT_BOOL('SP 50 PV 47 => T', sSp.Q, TRUE);
    sSp(SP := 40.0);
    KT_BOOL('SP ha 40 => F', sSp.Q, FALSE);
    (* đổi chế độ giữa chừng: SP 40 PV 47 làm lạnh ⇒ >= 42 ⇒ bật *)
    sSp(CHE_DO_LAM_LANH := TRUE);
    KT_BOOL('doi sang lanh PV 47 SP 40 => T', sSp.Q, TRUE);
    main := KT_TONG();
END_FUNCTION
