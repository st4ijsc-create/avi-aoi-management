using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
using St4i.EdgeCore.Licensing;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴 WS-E — mints Ed25519 key pairs and signs test licences <b>ENTIRELY IN MEMORY</b>.
///
/// <para><b>NO PRIVATE KEY EVER TOUCHES DISK OR THIS REPOSITORY.</b> That is not a nicety; it is the
/// constraint the owner's Ed25519 decision generated. A key pair generated here lives for the duration of
/// one test method and is garbage after it. The verifier under test is constructed with the PUBLIC half
/// through <see cref="LicenseVerifier(byte[])"/>'s injection seam — which is the entire reason that seam
/// exists — so nothing has to embed a real ST4I key or invent a fake one on disk to be testable.</para>
///
/// <para>🔴 <b>This helper can also sign WRONGLY, on purpose.</b> A licence-signing helper that could only
/// produce valid signatures would make every test a happy-path test, and a verifier that returns
/// <see langword="true"/> unconditionally passes every happy-path test ever written. <see cref="Sign"/>
/// takes whichever private key it is handed, so a test can sign with key A and verify against key B, and
/// <see cref="Envelope"/> takes arbitrary payload and signature bytes so a test can tamper with either
/// independently.</para>
/// </summary>
internal static class LicenseTestKit
{
    /// <summary>Generates an Ed25519 key pair in memory.</summary>
    /// <returns>The private and public halves; the public half is the 32 bytes a verifier takes.</returns>
    public static (Ed25519PrivateKeyParameters Private, byte[] PublicKey) NewKeyPair()
    {
        var generator = new Ed25519KeyPairGenerator();
        generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
        var pair = generator.GenerateKeyPair();
        var priv = (Ed25519PrivateKeyParameters)pair.Private;
        return (priv, ((Ed25519PublicKeyParameters)pair.Public).GetEncoded());
    }

    /// <summary>Signs arbitrary bytes with an arbitrary key — deliberately permissive so a test can
    /// produce a signature that is valid for the WRONG key.</summary>
    /// <param name="message">The bytes to sign.</param>
    /// <param name="key">The signing key.</param>
    /// <returns>The 64-byte signature.</returns>
    public static byte[] Sign(byte[] message, Ed25519PrivateKeyParameters key)
    {
        var signer = new Ed25519Signer();
        signer.Init(forSigning: true, key);
        signer.BlockUpdate(message, 0, message.Length);
        return signer.GenerateSignature();
    }

    /// <summary>Builds an envelope from arbitrary payload and signature bytes, so either can be tampered
    /// with independently of the other.</summary>
    /// <param name="payloadBytes">The payload bytes.</param>
    /// <param name="signatureBytes">The signature bytes.</param>
    /// <returns>The envelope JSON.</returns>
    public static string Envelope(byte[] payloadBytes, byte[] signatureBytes) =>
        JsonSerializer.Serialize(new
        {
            payload = Base64Url(payloadBytes),
            signature = Base64Url(signatureBytes),
        });

    /// <summary>Serialises a payload to the exact bytes that will be signed.</summary>
    /// <param name="payload">The payload.</param>
    /// <returns>The UTF-8 bytes.</returns>
    public static byte[] PayloadBytes(object payload) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));

    /// <summary>Signs a payload object and wraps it into a complete, valid envelope.</summary>
    /// <param name="payload">The payload object.</param>
    /// <param name="key">The signing key.</param>
    /// <returns>The envelope JSON.</returns>
    public static string SignedEnvelope(object payload, Ed25519PrivateKeyParameters key)
    {
        var bytes = PayloadBytes(payload);
        return Envelope(bytes, Sign(bytes, key));
    }

    /// <summary>
    /// Builds a payload object with sensible defaults, so each test only states the field it is about.
    /// </summary>
    /// <param name="edition">The edition label.</param>
    /// <param name="features">The feature strings, or <see langword="null"/> to let the edition decide.</param>
    /// <param name="fingerprint">The bound fingerprint. Defaults to
    /// <see cref="ThisMachine"/> — a licence bound to the machine running the test — because a payload
    /// bound to NOTHING is correctly refused as <c>WrongMachine</c>, which would make every test in this
    /// suite measure the fingerprint check instead of the thing it is about. Pass an explicit value to
    /// test the fingerprint check itself.</param>
    /// <param name="required">The fingerprint match threshold.</param>
    /// <param name="expiresAtUtc">Expiry, or <see langword="null"/> for perpetual.</param>
    /// <param name="graceDays">Grace window.</param>
    /// <param name="v">Payload format version.</param>
    /// <param name="bindingMode">The binding mode string; defaults to the BOUND
    /// <see cref="LicenseBindingMode.Machine"/>. Pass <see cref="LicenseBindingMode.Unbound"/> — or any
    /// near-miss — to test the mode itself.</param>
    /// <returns>An anonymous object shaped exactly like the licence payload.</returns>
    public static object Payload(
        string edition = "Machine",
        string[]? features = null,
        LicenseFingerprint? fingerprint = null,
        int required = 3,
        DateTimeOffset? expiresAtUtc = null,
        int graceDays = 30,
        int v = 1,
        string? bindingMode = null) =>
        new
        {
            v,
            licenseId = "ST4I-TEST-000001",
            customer = "Test Customer Co., Ltd.",
            edition,
            features,
            fingerprint = Bind(fingerprint ?? ThisMachine()),
            // 🔴 `mode` is ALWAYS emitted, defaulting to the BOUND mode in words. A payload that simply
            // omitted it would still be bound (LicenseBindingMode.IsUnbound treats absent as bound), but
            // emitting it means every test licence this kit produces looks like a real one, and the
            // tamper test can find a `"mode":"machine"` to try to edit.
            fingerprintPolicy = new
            {
                required,
                of = MachineFingerprint.ComponentNames,
                mode = bindingMode ?? LicenseBindingMode.Machine,
            },
            issuedAtUtc = "2026-01-01T00:00:00Z",
            notBeforeUtc = "2026-01-01T00:00:00Z",
            expiresAtUtc = expiresAtUtc?.ToUniversalTime().ToString("O"),
            graceDays,
            seats = 1,
            notes = "test",
        };

    /// <summary>
    /// 🔴 This machine's own fingerprint, so a test licence binds to the machine running the test.
    ///
    /// <para>Read through <see cref="MachineFingerprint.Read"/> with a <see langword="null"/> identity
    /// store, which means the deviceIdentity component reads whatever the ambient (test-redirected)
    /// identity root holds — usually nothing, so that component is null and the other three carry the
    /// match. Three of four is exactly the default threshold, which is the point: a test licence issued
    /// this way is bound the way a real one is, not waved through.</para>
    /// </summary>
    /// <returns>This machine's fingerprint.</returns>
    public static LicenseFingerprint ThisMachine() => MachineFingerprint.Read(null, out _);

    /// <summary>Shapes a fingerprint into the anonymous form the payload JSON carries.</summary>
    /// <param name="fingerprint">The fingerprint.</param>
    /// <returns>An anonymous object with the four component members.</returns>
    private static object Bind(LicenseFingerprint fingerprint) => new
    {
        deviceIdentity = fingerprint.DeviceIdentity,
        machineGuid = fingerprint.MachineGuid,
        volumeSerial = fingerprint.VolumeSerial,
        primaryMac = fingerprint.PrimaryMac,
    };

    /// <summary>base64url without padding.</summary>
    /// <param name="bytes">The bytes.</param>
    /// <returns>The encoded text.</returns>
    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
