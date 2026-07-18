namespace St4i.EdgeCore.Models;

public enum ReadingKind { ProcessResult, Telemetry, Inspection }

public enum DriverKind { Simulated, HotFolderAoi, Mqtt }

public enum DeviceClass { Automation, Iot, AoiAvi }

public enum TransportMode { Live, Demo, Auto }

public enum DriverHealthState { Connected, Degraded, Down }

public enum Verdict { Pass, Warn, Fail, Skip }
