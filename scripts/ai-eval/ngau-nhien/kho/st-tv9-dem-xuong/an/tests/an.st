FUNCTION main : DINT
VAR
    fb : TonKho;
END_VAR
    (* ban đầu tồn = 0 *)
    fb(LAY_RA := FALSE, NAP := FALSE, SO_NAP := 4, NGUONG_THAP := 2);
    KT_DINT('ban dau 0', fb.TON, 0);
    KT_BOOL('ban dau HET', fb.HET, TRUE);
    KT_BOOL('ban dau SAP_HET', fb.SAP_HET, TRUE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay khi 0 => van 0', fb.TON, 0);
    fb(LAY_RA := FALSE, NAP := TRUE);
    KT_DINT('nap 4', fb.TON, 4);
    KT_BOOL('nap 4 => khong HET', fb.HET, FALSE);
    KT_BOOL('nap 4 => khong SAP_HET', fb.SAP_HET, FALSE);
    fb(NAP := FALSE, LAY_RA := TRUE);
    KT_DINT('lay => 3', fb.TON, 3);
    fb(LAY_RA := TRUE);
    KT_DINT('giu lay khong tru them', fb.TON, 3);
    KT_BOOL('3 > 2 khong SAP_HET', fb.SAP_HET, FALSE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay => 2', fb.TON, 2);
    KT_BOOL('2 <= 2 => SAP_HET', fb.SAP_HET, TRUE);
    KT_BOOL('2 => khong HET', fb.HET, FALSE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay het => 0', fb.TON, 0);
    KT_BOOL('0 => HET', fb.HET, TRUE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay them khi 0 => 0', fb.TON, 0);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay them lan 2 khi 0 => 0', fb.TON, 0);
    KT_BOOL('van HET', fb.HET, TRUE);
    (* NAP cùng chu kỳ với sườn lấy: NAP ưu tiên *)
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE, NAP := TRUE, SO_NAP := 5);
    KT_DINT('nap + lay cung chu ky => 5', fb.TON, 5);
    fb(LAY_RA := TRUE, NAP := FALSE);
    KT_DINT('nha nap khi lay van giu => 5', fb.TON, 5);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_DINT('lay => 4', fb.TON, 4);
    (* NAP giữ nhiều chu kỳ: sườn lấy trong lúc nạp không trừ *)
    fb(LAY_RA := FALSE, NAP := TRUE);
    fb(LAY_RA := TRUE, NAP := TRUE);
    KT_DINT('nap giu, lay => 5', fb.TON, 5);
    fb(NAP := FALSE);
    KT_DINT('nha nap, lay giu => 5', fb.TON, 5);
    (* đổi ngưỡng *)
    fb(NGUONG_THAP := 4);
    KT_BOOL('5 > 4 khong SAP_HET', fb.SAP_HET, FALSE);
    fb(LAY_RA := FALSE);
    fb(LAY_RA := TRUE);
    KT_BOOL('4 <= 4 SAP_HET', fb.SAP_HET, TRUE);
    (* nạp 0 *)
    fb(NAP := TRUE, SO_NAP := 0);
    KT_DINT('nap 0', fb.TON, 0);
    KT_BOOL('nap 0 => HET', fb.HET, TRUE);
    main := KT_TONG();
END_FUNCTION
