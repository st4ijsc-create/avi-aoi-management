namespace St4i.Connector.Abstractions.Models;

public enum ReadingKind { ProcessResult, Telemetry, Inspection }

public enum DriverKind { Simulated, HotFolderAoi, Mqtt, Modbus, OpcUa }

public enum DeviceClass { Automation, Iot, AoiAvi }

public enum DriverHealthState { Connected, Degraded, Down }

public enum Verdict { Pass, Warn, Fail, Skip }
