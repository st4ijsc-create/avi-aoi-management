FUNCTION main : DINT
VAR
    fb : TonKho;
END_VAR
    fb(LAY_RA := FALSE, NAP := TRUE, SO_NAP := 3, NGUONG_THAP := 2);
    fb(NAP := FALSE, LAY_RA := TRUE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('nap 3, lay 2 => 1', fb.TON, 1);
    KT_BOOL('1 <= 2 => sap het', fb.SAP_HET, TRUE);
    KT_BOOL('1 => chua het', fb.HET, FALSE);
    main := KT_TONG();
END_FUNCTION
