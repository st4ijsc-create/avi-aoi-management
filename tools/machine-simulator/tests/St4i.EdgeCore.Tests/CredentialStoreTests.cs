using St4i.EdgeCore.Infrastructure;
using Xunit;

public class CredentialStoreTests
{
    [Fact]
    public void Save_then_load_roundtrips()
    {
        var code = "TEST-" + System.Guid.NewGuid().ToString("N").Substring(0, 8);
        CredentialStore.Save(code, "mk_secret_value");
        Assert.Equal("mk_secret_value", CredentialStore.Load(code));
    }

    [Fact]
    public void Load_missing_returns_null() =>
        Assert.Null(CredentialStore.Load("NOPE-" + System.Guid.NewGuid().ToString("N")));
}
