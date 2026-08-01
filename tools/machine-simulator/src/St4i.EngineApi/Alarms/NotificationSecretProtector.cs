using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-2 — the at-rest encryption for a notification channel's secrets, and a deliberate SIBLING of
/// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/> rather than an extension of it.
///
/// <para><b>Why a sibling and not an extension</b> (the brief's own "decide, and say which and why"):
/// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/> is keyed by <c>machineCode</c> and means one
/// specific thing — <i>this machine's own <c>mk_</c> identity key to the ST4I ecosystem</i>. An SMTP
/// password and a webhook signing key are not that. They belong to a THIRD PARTY (somebody else's mail
/// server, somebody else's Slack workspace), there may be several of them for one machine, they are keyed
/// by channel-and-purpose rather than by machine, and their lifecycle is the channel's, not the device's.
/// Extending <c>CredentialStore</c> would have meant either overloading <c>machineCode</c> to sometimes
/// mean "a channel name" — which breaks <c>ListMachineCodes</c>, whose whole job is to answer "which
/// machines have a stored key?" and which would start reporting <c>"Smtp"</c> as a machine — or adding a
/// second key dimension to a class three other subsystems already depend on. It also sits in
/// <c>St4i.EdgeCore</c>, which the alarm engine deliberately does not own.</para>
///
/// <para><b>What is NOT different, on purpose:</b> the mechanism itself is copied exactly, because the
/// brief's instruction is to follow the established idiom rather than invent one.
/// <see cref="ProtectedData"/> under <see cref="DataProtectionScope.LocalMachine"/>, a fixed entropy
/// constant, and <see cref="St4i.EdgeCore.Infrastructure.SecurityDirAcl"/> applied to the containing
/// directory on every save — the same three parts <c>CredentialStore</c> and
/// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore"/> both use.</para>
///
/// <para>🔴 <b><see cref="DataProtectionScope.LocalMachine"/> is not a mistake to be "fixed" later.</b>
/// A machine is commonly configured interactively by a logged-in engineer but RUNS as a Windows
/// Service/LocalSystem account; under <see cref="DataProtectionScope.CurrentUser"/> the service could not
/// decrypt what the interactive session wrote, and the SMTP password would simply stop working on the
/// next restart with no explanation.</para>
///
/// <para>🔴 <b>What the ACL covers and what DPAPI covers — they are NOT the same threat, and review round
/// 1 (I2) turned on getting this right.</b> A <c>LocalMachine</c> blob is decryptable by any local
/// account, so the directory ACL is the confidentiality boundary <i>against another account on this
/// machine</i> — which is why <see cref="NotificationConfigStore.SetSecretAsync"/> re-applies it on every
/// save rather than only at first creation. But DPAPI still carries real residual value the ACL cannot:
/// <b>machine-binding</b>. An ACL protects a file that stays put; it does nothing once the file LEAVES —
/// in a backup, a support bundle, a <c>%ProgramData%</c> snapshot, a database attached to a bug report.
/// A DPAPI blob in any of those is inert on any other machine. That is precisely why every
/// capability-grade value this product stores is sealed here rather than sitting in a plaintext column
/// next to one that is: a copied <c>notifications.db</c> must not hand anybody a working credential.</para>
///
/// <para><b>Entropy is its own constant</b>, distinct from <c>CredentialStore</c>'s and
/// <c>DeviceIdentityStore</c>'s. That is what makes a blob from one store unreadable by another even
/// though all three share a DPAPI scope — a notification secret accidentally handed to the credential
/// loader reads as corrupt (i.e. absent) instead of as a valid-looking wrong answer.</para>
/// </summary>
[SupportedOSPlatform("windows")]
internal static class NotificationSecretProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("st4i.engineapi.notificationsecrets.v1");

    /// <summary>DPAPI-protects <paramref name="plaintext"/>. Throws only what
    /// <see cref="ProtectedData.Protect"/> itself throws; the caller
    /// (<see cref="NotificationConfigStore"/>) is never-throws and absorbs it.</summary>
    public static byte[] Protect(string plaintext) =>
        ProtectedData.Protect(Encoding.UTF8.GetBytes(plaintext), Entropy, DataProtectionScope.LocalMachine);

    /// <summary>
    /// Reverses <see cref="Protect"/>, or returns <see langword="null"/> if the bytes cannot be
    /// unprotected.
    ///
    /// <para>🔴 A <see cref="CryptographicException"/> here means the blob is corrupt, was written under
    /// different entropy or a different scope, or was copied in from another machine — and every one of
    /// those is reported as "there is no stored secret", never as an exception. This is the same rule
    /// <c>CredentialStore.Load</c> and <c>DeviceIdentityStore.TryLoad</c> both follow, and it matters
    /// more here than a tidiness argument suggests: this method is reached from the notification dispatch
    /// path, so a single unreadable blob that threw would take down the delivery of every OTHER channel's
    /// alarms too. Absent is a state a caller already has to handle; thrown is not.</para>
    /// </summary>
    public static string? TryUnprotect(byte[] blob)
    {
        try
        {
            return Encoding.UTF8.GetString(
                ProtectedData.Unprotect(blob, Entropy, DataProtectionScope.LocalMachine));
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}
