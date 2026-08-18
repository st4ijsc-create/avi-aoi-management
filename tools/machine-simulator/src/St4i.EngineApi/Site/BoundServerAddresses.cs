using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace St4i.EngineApi.Site;

/// <summary>
/// 🔴 Task AC-1 — reads the host's ACTUALLY-BOUND listen addresses off
/// <see cref="IServerAddressesFeature"/> and hands them out as an
/// <see cref="IReadOnlyCollection{T}"/>, by MATERIALISING them.
///
/// <para><b>Why this type exists at all — it is one expression, and the expression it replaces was
/// wrong in a way nothing in 2755 tests could see.</b> <c>Program.cs</c> used to supply
/// <see cref="SiteAdvertiser"/>'s <c>resolveBoundAddresses</c> delegate inline, as
/// <c>… .Features.Get&lt;IServerAddressesFeature&gt;()?.Addresses as IReadOnlyCollection&lt;string&gt;</c>.
/// <see cref="IServerAddressesFeature.Addresses"/> is declared <see cref="ICollection{T}"/>, and under
/// KESTREL its runtime type is
/// <c>Microsoft.AspNetCore.Server.Kestrel.Core.Internal.ServerAddressesCollection+PublicServerAddressesCollection</c>,
/// whose interface list is exactly <c>ICollection&lt;string&gt;</c>, <c>IEnumerable&lt;string&gt;</c>,
/// <c>IEnumerable</c> — <b>and not <c>IReadOnlyCollection&lt;string&gt;</c></b> (measured on
/// net10.0-windows against a real started Kestrel host; see
/// <c>BoundServerAddressesTests.Read_OverARealListeningKestrelHost_ReturnsTheAddressesTheHostIsBoundTo</c>).
/// A reference conversion that cannot succeed yields <see langword="null"/> SILENTLY, so the delegate
/// answered <see langword="null"/> on every call, in every process, at every moment — bound or not —
/// and <see cref="SiteAdvertiser.ResolvePort"/> reported that as
/// <i>"No server addresses are bound yet"</i>. The message names a TIMING cause for a TYPE fault, which
/// is why the failure reads as if the startup deferral had not worked.</para>
///
/// <para>🔴 <b>The deferral it was blamed on is not the defect and must not be "fixed".</b> On the
/// published build the failure is logged AFTER <c>Now listening on: http://localhost:5199</c> and AFTER
/// <c>Application started.</c> — so <see cref="SiteAdvertiser.StartAsync"/>'s
/// <see cref="Microsoft.Extensions.Hosting.IHostApplicationLifetime.ApplicationStarted"/> registration
/// does exactly what its own doc comment claims, and the addresses ARE populated by the time
/// <see cref="SiteAdvertiser.Start"/> runs. Nothing about the ordering needed to change.</para>
///
/// <para><b>Why the neighbour survived.</b> <c>Program.cs</c>' OTHER reader of this same feature — the
/// WS-D-D5 loopback-exposure check — spells it <c>addressesFeature?.Addresses.ToArray()</c>. Same
/// feature, same lifetime event, one materialises and one casts; only the casting one is blind. That
/// asymmetry is the whole finding, and this type exists so there is ONE reader of this feature to be
/// right or wrong, instead of two spellings that agree only by luck.</para>
///
/// <para><b>Why no test saw it.</b> <c>SiteAdvertiserTests</c> supplies in-memory delegates whose
/// collections are <c>string[]</c>/<c>List&lt;string&gt;</c> — both of which DO implement
/// <see cref="IReadOnlyCollection{T}"/>, so the cast succeeds there. The twelve
/// <c>WebApplicationFactory&lt;Program&gt;</c> suites run on <c>TestServer</c>, not Kestrel, and
/// <c>TestServer</c>'s address feature is the plain
/// <c>Microsoft.AspNetCore.Hosting.Server.Features.ServerAddressesFeature</c> backed by a
/// <c>List&lt;string&gt;</c>. The defective conversion is reachable ONLY from a process that actually
/// binds Kestrel, which is why a trial run found it and the suite did not.</para>
/// </summary>
internal static class BoundServerAddresses
{
    /// <summary>The addresses <paramref name="server"/> is currently bound to, as an independent
    /// snapshot; <see langword="null"/> when the server exposes no
    /// <see cref="IServerAddressesFeature"/> at all. An EMPTY result is returned as an empty collection
    /// rather than as <see langword="null"/> — the two are equivalent to
    /// <see cref="SiteAdvertiser.ResolvePort"/> (both raise its "no server addresses are bound yet"
    /// failure) and keeping them distinct here costs nothing and keeps "the feature is missing" from
    /// looking like "the host has not started listening".</summary>
    /// <remarks><b>A COPY, deliberately.</b> <see cref="Enumerable.ToArray{TSource}"/> is what makes the
    /// declared return type honest for any implementation of the feature, and it also detaches the
    /// result from a live collection Kestrel keeps mutating — the caller
    /// (<see cref="SiteAdvertiser.Start"/>) reads it under its own lock and must not be handed a view
    /// that can change underneath it.</remarks>
    internal static IReadOnlyCollection<string>? Read(IServer server)
    {
        ArgumentNullException.ThrowIfNull(server);

        var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
        return addresses?.ToArray();
    }
}
