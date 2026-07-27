namespace St4i.EngineApi.Safety;

public sealed record SafetyStatusDto(bool EstopEngaged, bool IsRunning, string SafetyClass, string Advisory);
