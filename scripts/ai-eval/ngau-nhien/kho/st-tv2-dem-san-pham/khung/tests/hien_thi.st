FUNCTION main : DINT
VAR
    fb : DemSanPham;
END_VAR
    fb(CAM_BIEN := FALSE, KICH_THUOC_LO := 5, RESET := FALSE);
    fb(CAM_BIEN := TRUE);
    fb(CAM_BIEN := TRUE);
    fb(CAM_BIEN := FALSE);
    fb(CAM_BIEN := TRUE);
    KT_DINT('2 suon => DEM 2', fb.DEM, 2);
    KT_BOOL('chua du lo', fb.XONG_LO, FALSE);
    KT_DINT('SO_LO 0', fb.SO_LO, 0);
    main := KT_TONG();
END_FUNCTION
