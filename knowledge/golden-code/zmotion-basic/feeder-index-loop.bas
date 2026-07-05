' SAFETY: AI-assisted golden example. The author reviews, validates and tests it on the ZMC
' emulator before any download. MOTION/PROCESS only - E-stop / SIL stay on the controller.
'
' Index a feeder: 5 relative steps of +60 units with a dwell between each (Zmotion ZBasic).
DIM i                ' loop counter
BASE(0)
SPEED = 120
ACCEL = 1500
DECEL = 1500
FOR i = 1 TO 5
    MOVE(60)         ' relative move by +60 units
    WAIT IDLE        ' finish the step before dwelling
    DELAY(200)       ' dwell 200 ms between indexes
NEXT i
PRINT "index sequence complete"
