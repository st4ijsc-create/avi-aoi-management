using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the shared
/// argument-type-narrowing utility every command declaration (Modbus, OPC-UA) reuses. Proves the exact re-
/// narrowing B-1's own doc comment on <see cref="CommandRequest.Arguments"/> says an implementation must
/// perform: a boxed <see cref="long"/>/<see cref="double"/>/<see cref="bool"/>/<see cref="string"/> (the
/// <see cref="St4i.Connector.Abstractions.Json.ConnectorObjectConverter"/> domain) narrowed against a declared
/// <see cref="CommandArgumentType"/>, bounds-checked against both the type's own representable range and any
/// declared <see cref="CommandArgumentDeclaration.Min"/>/<see cref="CommandArgumentDeclaration.Max"/>.
/// </summary>
public sealed class CommandArgumentDeclarationTests
{
    // ─────────────────────────────────────────────────────────────────────
    // ValidateSelf — schema-shape checks.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ValidateSelf_BlankName_Rejected(string blankName)
    {
        var declaration = new CommandArgumentDeclaration(blankName, CommandArgumentType.UInt16);
        Assert.Contains("non-blank", declaration.ValidateSelf());
    }

    [Fact]
    public void ValidateSelf_MinMaxOnBoolType_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("enable", CommandArgumentType.Bool, Min: 0, Max: 1);
        Assert.Contains("min/max", declaration.ValidateSelf());
    }

    [Fact]
    public void ValidateSelf_MinMaxOnStringType_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("recipe", CommandArgumentType.String, Min: 0, Max: 1);
        Assert.Contains("min/max", declaration.ValidateSelf());
    }

    [Fact]
    public void ValidateSelf_MinGreaterThanMax_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16, Min: 100, Max: 10);
        Assert.Contains("must be <=", declaration.ValidateSelf());
    }

    [Fact]
    public void ValidateSelf_WellFormedDeclaration_ReturnsNull()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16, Min: 0, Max: 5000);
        Assert.Null(declaration.ValidateSelf());
    }

    [Fact]
    public void ValidateSelf_NoBoundsAtAll_AlwaysValid_RangeIsOptional()
    {
        var declaration = new CommandArgumentDeclaration("mode", CommandArgumentType.Int32);
        Assert.Null(declaration.ValidateSelf());
    }

    // ─────────────────────────────────────────────────────────────────────
    // TryNarrow — the re-narrowing itself.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryNarrow_Bool_MatchingType_Succeeds()
    {
        var declaration = new CommandArgumentDeclaration("enable", CommandArgumentType.Bool);
        Assert.True(declaration.TryNarrow(true, out var narrowed, out var error));
        Assert.Equal(true, narrowed);
        Assert.Null(error);
    }

    [Fact]
    public void TryNarrow_Bool_WrongRuntimeType_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("enable", CommandArgumentType.Bool);
        Assert.False(declaration.TryNarrow(1L, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("Bool", error);
    }

    [Fact]
    public void TryNarrow_String_MatchingType_Succeeds()
    {
        var declaration = new CommandArgumentDeclaration("recipe", CommandArgumentType.String);
        Assert.True(declaration.TryNarrow("Recipe-A", out var narrowed, out _));
        Assert.Equal("Recipe-A", narrowed);
    }

    /// <summary>The exact scenario B-1's own doc comment describes: an OPC-UA <c>UInt16</c> argument arrives
    /// through <see cref="St4i.Connector.Abstractions.Json.ConnectorObjectConverter"/> as a boxed
    /// <see cref="long"/> (every integral JSON number widens to <see langword="long"/>) — this must narrow to
    /// an actual <see cref="ushort"/>, not merely pass a type check.</summary>
    [Fact]
    public void TryNarrow_UInt16_FromBoxedLong_NarrowsToActualUShort()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16);
        Assert.True(declaration.TryNarrow(5000L, out var narrowed, out var error));
        Assert.Null(error);
        Assert.IsType<ushort>(narrowed);
        Assert.Equal((ushort)5000, narrowed);
    }

    [Theory]
    [InlineData(CommandArgumentType.Int16, -32769L)]
    [InlineData(CommandArgumentType.Int16, 32768L)]
    [InlineData(CommandArgumentType.UInt16, -1L)]
    [InlineData(CommandArgumentType.UInt16, 65536L)]
    [InlineData(CommandArgumentType.Int32, (long)int.MaxValue + 1)]
    [InlineData(CommandArgumentType.UInt32, -1L)]
    public void TryNarrow_IntegralOutsideTypesOwnRepresentableRange_Rejected_NeverWraps(CommandArgumentType type, long rawValue)
    {
        var declaration = new CommandArgumentDeclaration("value", type);
        Assert.False(declaration.TryNarrow(rawValue, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("representable range", error);
    }

    [Fact]
    public void TryNarrow_IntegralWithinRepresentableRange_ButOutsideDeclaredMinMax_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16, Min: 0, Max: 3000);
        Assert.False(declaration.TryNarrow(4000L, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("declared", error);
    }

    [Fact]
    public void TryNarrow_Double_FromBoxedLong_WidensLosslessly()
    {
        // A caller sending a whole-number JSON value ("setpoint": 20) for a Double-typed argument arrives as
        // a boxed long (ConnectorObjectConverter's decision (a)) — must still be accepted, widened to double.
        var declaration = new CommandArgumentDeclaration("setpoint", CommandArgumentType.Double);
        Assert.True(declaration.TryNarrow(20L, out var narrowed, out _));
        Assert.IsType<double>(narrowed);
        Assert.Equal(20.0, narrowed);
    }

    [Fact]
    public void TryNarrow_Double_OutsideDeclaredRange_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("setpoint", CommandArgumentType.Double, Min: 0, Max: 100);
        Assert.False(declaration.TryNarrow(150.0, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("declared", error);
    }

    [Fact]
    public void TryNarrow_IntegralType_GivenADouble_NeverSilentlyTruncated_Rejected()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16);
        Assert.False(declaration.TryNarrow(20.5, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("UInt16", error);
    }

    [Fact]
    public void TryNarrow_Null_NeverMatchesAnyType()
    {
        var declaration = new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16);
        Assert.False(declaration.TryNarrow(null, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.NotNull(error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TryNarrowAll — the whole-request shape.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryNarrowAll_EveryArgumentSuppliedAndValid_Succeeds()
    {
        var declared = new[]
        {
            new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16, 0, 5000),
            new CommandArgumentDeclaration("enable", CommandArgumentType.Bool),
        };
        var supplied = new Dictionary<string, object> { ["speed"] = 1200L, ["enable"] = true };

        Assert.True(CommandArgumentDeclaration.TryNarrowAll(declared, supplied, out var narrowed, out var error));
        Assert.Null(error);
        Assert.Equal((ushort)1200, narrowed["speed"]);
        Assert.Equal(true, narrowed["enable"]);
    }

    [Fact]
    public void TryNarrowAll_MissingRequiredArgument_Rejected()
    {
        var declared = new[] { new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16) };
        var supplied = new Dictionary<string, object>();

        Assert.False(CommandArgumentDeclaration.TryNarrowAll(declared, supplied, out var narrowed, out var error));
        Assert.Empty(narrowed);
        Assert.Contains("missing required argument", error);
        Assert.Contains("speed", error);
    }

    [Fact]
    public void TryNarrowAll_UnknownSuppliedArgument_Rejected_NeverSilentlyIgnored()
    {
        var declared = new[] { new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16) };
        var supplied = new Dictionary<string, object> { ["speed"] = 100L, ["typo_spedd"] = 100L };

        Assert.False(CommandArgumentDeclaration.TryNarrowAll(declared, supplied, out var narrowed, out var error));
        Assert.Empty(narrowed);
        Assert.Contains("unknown argument", error);
        Assert.Contains("typo_spedd", error);
    }

    [Fact]
    public void TryNarrowAll_NullSuppliedDictionary_TreatedAsEmpty_RequiredArgumentStillMissing()
    {
        var declared = new[] { new CommandArgumentDeclaration("speed", CommandArgumentType.UInt16) };

        Assert.False(CommandArgumentDeclaration.TryNarrowAll(declared, supplied: null, out _, out var error));
        Assert.Contains("missing required argument", error);
    }

    [Fact]
    public void TryNarrowAll_NoDeclaredArguments_EmptySupplied_Succeeds()
    {
        Assert.True(CommandArgumentDeclaration.TryNarrowAll(
            Array.Empty<CommandArgumentDeclaration>(), supplied: null, out var narrowed, out var error));
        Assert.Empty(narrowed);
        Assert.Null(error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // IntegralRange
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(CommandArgumentType.Int16, short.MinValue, short.MaxValue)]
    [InlineData(CommandArgumentType.UInt16, ushort.MinValue, ushort.MaxValue)]
    [InlineData(CommandArgumentType.Int32, int.MinValue, int.MaxValue)]
    [InlineData(CommandArgumentType.UInt32, uint.MinValue, uint.MaxValue)]
    public void IntegralRange_MatchesTheClrTypesOwnBounds(CommandArgumentType type, long expectedMin, long expectedMax)
    {
        var (min, max) = CommandArgumentDeclaration.IntegralRange(type);
        Assert.Equal(expectedMin, min);
        Assert.Equal(expectedMax, max);
    }

    [Theory]
    [InlineData(CommandArgumentType.Bool)]
    [InlineData(CommandArgumentType.String)]
    public void IntegralRange_NonIntegralType_Throws(CommandArgumentType type)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CommandArgumentDeclaration.IntegralRange(type));
    }
}
