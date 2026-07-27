namespace St4i.EngineApi.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — ISA-95-flavored asset lifecycle. A machine is registered/re-registered
/// as <see cref="Active"/> (it's operational, and re-registering must never silently downgrade it — see
/// <see cref="AssetRegistryStore"/>'s upsert doc comment for why <c>lifecycle</c> is preserved on
/// conflict); the others are reachable only via an explicit operator transition through
/// <c>PUT /v1/assets/{code}/lifecycle</c>.
/// </summary>
public enum AssetLifecycleState { Provisioned, Commissioning, Active, Maintenance, Decommissioned }
