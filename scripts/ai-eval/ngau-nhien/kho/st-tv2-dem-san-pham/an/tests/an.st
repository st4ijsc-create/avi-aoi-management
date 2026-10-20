FUNCTION main : DINT
VAR
    fb : DemSanPham;
    fb1 : DemSanPham;
END_VAR
    (* lô 3; CAM_BIEN = TRUE ngay lần gọi đầu là sườn lên *)
    fb(CAM_BIEN := TRUE, KICH_THUOC_LO := 3, RESET := FALSE);
    KT_DINT('goi dau TRUE => DEM 1', fb.DEM, 1);
    fb(CAM_BIEN := TRUE);
    KT_DINT('giu TRUE khong dem', fb.DEM, 1);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('suon 2', fb.DEM, 2);
    KT_BOOL('suon 2 chua xong', fb.XONG_LO, FALSE);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    (* sườn thứ 3 = đủ lô: XONG_LO, SO_LO 1, DEM về 0 ngay chu kỳ này *)
    KT_BOOL('du lo => XONG_LO', fb.XONG_LO, TRUE);
    KT_DINT('du lo => SO_LO 1', fb.SO_LO, 1);
    KT_DINT('du lo => DEM 0 ngay', fb.DEM, 0);
    fb(CAM_BIEN := TRUE);
    KT_BOOL('XONG_LO dung 1 chu ky', fb.XONG_LO, FALSE);
    KT_DINT('SO_LO khong tang lai', fb.SO_LO, 1);
    KT_DINT('DEM van 0', fb.DEM, 0);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('san pham ke tiep = 1', fb.DEM, 1);
    (* lô thứ hai đủ *)
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('lo 2 => SO_LO 2', fb.SO_LO, 2);
    KT_BOOL('lo 2 => XONG_LO', fb.XONG_LO, TRUE);
    (* RESET cùng chu kỳ với sườn: ưu tiên RESET *)
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE, RESET := TRUE);
    KT_DINT('reset cung suon => DEM 0', fb.DEM, 0);
    KT_DINT('reset => SO_LO 0', fb.SO_LO, 0);
    fb(CAM_BIEN := TRUE, RESET := FALSE);
    KT_DINT('nha reset khi cam bien con TRUE => 0', fb.DEM, 0);
    (* RESET đúng chu kỳ sẽ đủ lô: không XONG_LO *)
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('DEM 2 truoc reset', fb.DEM, 2);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE, RESET := TRUE);
    KT_BOOL('reset luc du lo => khong XONG_LO', fb.XONG_LO, FALSE);
    KT_DINT('reset luc du lo => SO_LO 0', fb.SO_LO, 0);
    KT_DINT('reset luc du lo => DEM 0', fb.DEM, 0);
    (* RESET giữ nhiều chu kỳ: không đếm *)
    fb(CAM_BIEN := FALSE, RESET := TRUE);
    fb(CAM_BIEN := TRUE, RESET := TRUE);
    KT_DINT('reset giu => 0', fb.DEM, 0);
    fb(CAM_BIEN := FALSE, RESET := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('sau reset dem lai 1', fb.DEM, 1);

    (* lô 1: mỗi sườn là một lô *)
    fb1(CAM_BIEN := FALSE, KICH_THUOC_LO := 1, RESET := FALSE);
    KT_BOOL('lo1 ban dau khong xong', fb1.XONG_LO, FALSE);
    fb1(CAM_BIEN := TRUE);
    KT_BOOL('lo1 suon 1 xong', fb1.XONG_LO, TRUE);
    KT_DINT('lo1 DEM 0', fb1.DEM, 0);
    fb1(CAM_BIEN := FALSE);
    KT_BOOL('lo1 het xung', fb1.XONG_LO, FALSE);
    fb1(CAM_BIEN := TRUE);
    KT_DINT('lo1 SO_LO 2', fb1.SO_LO, 2);
    main := KT_TONG();
END_FUNCTION
