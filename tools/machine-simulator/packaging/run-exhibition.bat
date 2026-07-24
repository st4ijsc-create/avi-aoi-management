@echo off
rem ST4I Machine Simulator — exhibition launcher (docs/PRODUCTION_UI_DESIGN.md WS2 §2.5, README.md §13).
rem
rem Copy this file into the SAME folder as St4i.DesktopShell.exe (the publish-desktop\ output — see
rem README.md §13.2) and double-click IT instead of the .exe directly. It sets ST4I_DEMO_ENABLED
rem before launching the shell, which passes the flag through to the engine child process it spawns
rem (St4i.EngineApi.Config.DemoModeGate reads it once at engine startup — see MainWindow.xaml.cs's
rem explicit passthrough in LaunchEngineProcess). The result: the app boots straight into the offline,
rem fabricated 11-machine Demo fleet, zero clicks, zero network — the exhibition-floor experience.
rem
rem Do NOT set this flag for a customer/product install. Leaving it unset (just double-click the .exe
rem on its own, no launcher) is the product default: the engine starts in Live mode and the web UI
rem shows a "Connect ecosystem" screen until a real ST4I server is configured.

set ST4I_DEMO_ENABLED=true
start "" "%~dp0St4i.DesktopShell.exe"
