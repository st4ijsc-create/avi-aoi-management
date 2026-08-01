' SAFETY: AI-assisted golden example. The author reviews, validates and tests it on the ZMC
' emulator before any download. Authors MOTION/PROCESS only - hardware limits, E-stop and SIL
' safety stay on the certified controller, never in this program.
'
' Single-axis absolute positioning move on axis 0 (Zmotion ZBasic / RTBasic).
BASE(0)              ' select axis 0 as the current motion base
ATYPE = 1            ' axis type: 1 = pulse / step-dir servo
UNITS = 100          ' encoder/pulse counts per user unit (e.g. per mm)
SPEED = 200          ' demand speed, user units per second
ACCEL = 2000         ' acceleration, units per second^2
DECEL = 2000         ' deceleration, units per second^2
MOVEABS(150)         ' absolute positioning move to coordinate 150 units
WAIT IDLE            ' block this task until the axis reaches target and stops
PRINT "cycle done"   ' trace to the ZMC terminal
