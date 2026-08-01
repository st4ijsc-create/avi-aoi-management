namespace St4i.EdgeCore.Models;

public record TransportAck(
    bool Success,
    long? Id = null,
    bool Duplicate = false,
    bool Queued = false,
    int Accepted = 0,
    int HttpStatus = 0,
    long LatencyMs = 0,
    string? RawBody = null,
    string? Error = null);

public record HeartbeatResult(bool Success, long? MachineId, string? KeyStatus, int? KeyExpiresInDays);

public record ConfigSyncResult(bool Changed, string? Version, string? DriftState, bool Applied = true);
