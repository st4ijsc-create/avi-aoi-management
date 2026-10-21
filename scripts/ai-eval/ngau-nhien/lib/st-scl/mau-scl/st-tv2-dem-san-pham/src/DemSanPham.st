FUNCTION_BLOCK "DemSanPham"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      CAM_BIEN : Bool;
      KICH_THUOC_LO : Int;
      RESET : Bool;
   END_VAR

   VAR_OUTPUT
      DEM : Int;
      XONG_LO : Bool;
      SO_LO : Int;
   END_VAR

   VAR
      suon : R_TRIG;
      ctuDem : CTU_INT;
   END_VAR

BEGIN
   #suon(CLK := #CAM_BIEN);
   #ctuDem(CU := #suon.Q, R := #RESET, PV := #KICH_THUOC_LO);
   #XONG_LO := FALSE;
   IF #RESET THEN
      #SO_LO := 0;
   ELSIF #ctuDem.Q THEN
      #XONG_LO := TRUE;
      #SO_LO := #SO_LO + 1;
      #ctuDem(CU := FALSE, R := TRUE);   // về 0 ngay trong chu kỳ đủ lô
   END_IF;
   #DEM := #ctuDem.CV;
END_FUNCTION_BLOCK
