using System.Security.Cryptography.X509Certificates;

namespace St4i.EdgeCore.Identity;

/// <summary>
/// GĐ3 EC-1 — an immutable view of the device's identity: the loaded certificate (WITH private key,
/// usable for mTLS), its public-cert PEM (to register at a SYNAPSE Site during pairing), and its SHA-256
/// fingerprint (hex, uppercase, no separators) for display/pairing. This is EC-2's foundation: the
/// northbound bridge presents <see cref="Certificate"/> as its client certificate during the TLS
/// handshake, and an operator (or an automated pairing flow) compares <see cref="Fingerprint"/> against
/// what the Site expects before trusting the connection.
///
/// Ownership note: <see cref="Certificate"/> is a live <see cref="X509Certificate2"/> handle. Its private
/// key is loaded with <see cref="X509KeyStorageFlags.PersistKeySet"/> (EC-1 review C-1 — NOT
/// <see cref="X509KeyStorageFlags.EphemeralKeySet"/>: an ephemeral-keyset certificate was empirically
/// verified to fail a real mutual-TLS handshake on Windows/schannel, even though <c>HasPrivateKey</c>
/// still reports <see langword="true"/> — see <see cref="DeviceIdentityStore"/>'s own doc comment for the
/// full story), so it is usable for exactly the mTLS client-auth handshake it exists for.
/// <see cref="DeviceIdentityStore"/> does not dispose it; whichever caller keeps it alive for the process
/// lifetime (the bridge) owns disposal, same as any other <c>X509Certificate2</c> handed out by this
/// codebase.
/// </summary>
public sealed record DeviceIdentity(X509Certificate2 Certificate, string CertificatePem, string Fingerprint, string NodeId);
