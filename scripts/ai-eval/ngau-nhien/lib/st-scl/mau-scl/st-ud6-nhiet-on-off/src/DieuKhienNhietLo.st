FUNCTION_BLOCK "DieuKhienNhietLo"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      BAT : Bool;
      NHIET : Real;
      SP : Real;
      TRE : Real;
      NGUONG_CAO : Real;
      NGUONG_HH : Real;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      SUOI : Bool;
      CANH_BAO_CAO : Bool;
      NGAT_HH : Bool;
      LOI_CAM_BIEN : Bool;
      TRANG_THAI : Int;  // 0 TAT, 1 DIEU_KHIEN, 2 NGAT_HH, 3 LOI_CAM_BIEN
   END_VAR

   VAR
      boTre : "TreHaiNguong";
   END_VAR

BEGIN
   #LOI_CAM_BIEN := #NHIET < -50.0 OR #NHIET > 500.0;
   #boTre(X := #NHIET, SP := #SP, TRE := #TRE);
   #CANH_BAO_CAO := NOT #LOI_CAM_BIEN AND #NHIET >= #NGUONG_CAO;
   IF NOT #LOI_CAM_BIEN AND #NHIET >= #NGUONG_HH THEN
      #NGAT_HH := TRUE;
   ELSIF #RESET AND NOT #LOI_CAM_BIEN AND #NHIET < #SP THEN
      #NGAT_HH := FALSE;
   END_IF;
   #SUOI := #BAT AND #boTre.Q AND NOT #NGAT_HH AND NOT #LOI_CAM_BIEN;
   IF #LOI_CAM_BIEN THEN
      #TRANG_THAI := 3;
   ELSIF #NGAT_HH THEN
      #TRANG_THAI := 2;
   ELSIF NOT #BAT THEN
      #TRANG_THAI := 0;
   ELSE
      #TRANG_THAI := 1;
   END_IF;
END_FUNCTION_BLOCK
