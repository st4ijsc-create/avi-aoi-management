namespace St4i.EdgeCore.Models;

public record CanonicalEnvelope(ReadingKind Kind, string MachineCode, string Path, Dictionary<string, object> Payload, string IdempotencyKey);
