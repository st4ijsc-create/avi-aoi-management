FUNCTION_BLOCK "DocTangGiam"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      DICH : Real;
      TOC_DO_TANG : Real;
      TOC_DO_GIAM : Real;
      BAT : Bool;
   END_VAR

   VAR_OUTPUT
      RA : Real;
      DA_TOI : Bool;
   END_VAR

   VAR
      batCu : Bool;
      tCu : Time;
   END_VAR

   VAR_TEMP
      dtGiay : Real;
   END_VAR

BEGIN
   IF NOT #BAT THEN
      #RA := #DICH;
      #batCu := FALSE;
   ELSE
      IF NOT #batCu THEN
         #dtGiay := 0.0;
         #batCu := TRUE;
      ELSE
         #dtGiay := LINT_TO_REAL(TIME_TO_LINT("G_NOW" - #tCu)) / 1.0E9;
      END_IF;
      #tCu := "G_NOW";
      IF #DICH > #RA THEN
         #RA := MIN(IN1 := #RA + #TOC_DO_TANG * #dtGiay, IN2 := #DICH);
      ELSIF #DICH < #RA THEN
         #RA := MAX(IN1 := #RA - #TOC_DO_GIAM * #dtGiay, IN2 := #DICH);
      END_IF;
   END_IF;
   #DA_TOI := #RA = #DICH;
END_FUNCTION_BLOCK
