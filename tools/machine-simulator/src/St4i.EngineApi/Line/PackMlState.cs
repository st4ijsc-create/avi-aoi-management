namespace St4i.EngineApi.Line;

/// <summary>GĐ3 sub-4 LC-3 (.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/
/// task-3-brief.md) — a pragmatic PackML/ISA-88 stable-state subset: the transient states a real PackML
/// state model names (Starting/Stopping/Holding/Aborting/Resetting/...) are instantaneous for a
/// synchronous <see cref="Fleet.FleetHost"/> (its Start/Stop/Estop/ResetEstop calls return only once the
/// underlying pipeline transition has already happened — see FleetHost's own doc comments), so this only
/// models the STABLE states a caller can ever actually observe between commands. <see cref="LineController"/>
/// is the state machine driven by these two enums.</summary>
public enum PackMlState { Idle, Execute, Held, Stopped, Aborted }

/// <summary>The operator commands <see cref="LineController.Execute"/> accepts — one per
/// <c>POST /v1/line/{command}</c> route segment (lowercased). See <see cref="LineController"/>'s own doc
/// comment for the full transition table.</summary>
public enum LineCommand { Start, Hold, Unhold, Stop, Abort, Reset }
