using Microsoft.AspNetCore.Identity;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>WS-D-D1 — <see cref="SqliteUserStore"/> over a fresh temp directory per test (never the real
/// %ProgramData% root, never ST4I_SECURITY_DIR mutation — the ctor's explicit directory override is
/// enough, so there's no env-var-based test flakiness risk here at all).</summary>
public sealed class SqliteUserStoreTests
{
    private static string NewTempDir() => Directory.CreateTempSubdirectory("st4i-security-tests-").FullName;

    private static PasswordHasher<AppUser> Hasher() => new();

    [Fact]
    public async Task CountAsync_IsZero_ForABrandNewStore()
    {
        var store = new SqliteUserStore(NewTempDir());
        Assert.Equal(0, await store.CountAsync());
    }

    [Fact]
    public async Task CreateAsync_ThenGetByUsername_RoundTrips_CaseInsensitively()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var hash = hasher.HashPassword(AppUser.Instance, "Sup3rSecret!");

        var created = await store.CreateAsync("Alice", hash, Roles.Admin, "Alice Admin", createdBy: "test");

        Assert.True(created.Id > 0);
        Assert.Equal(1, await store.CountAsync());

        var byExact = await store.GetByUsernameAsync("Alice");
        Assert.NotNull(byExact);
        Assert.Equal(created.Id, byExact!.Id);
        Assert.Equal("Alice", byExact.Username);
        Assert.Equal(Roles.Admin, byExact.Role);
        Assert.Equal("Alice Admin", byExact.DisplayName);
        Assert.False(byExact.Disabled);
        Assert.False(byExact.MustChangePassword);
        Assert.False(string.IsNullOrWhiteSpace(byExact.SecurityStamp));
        Assert.Null(byExact.LastLoginAtUtc);

        var byLower = await store.GetByUsernameAsync("alice");
        Assert.NotNull(byLower);
        Assert.Equal(created.Id, byLower!.Id);

        var byUpper = await store.GetByUsernameAsync("ALICE");
        Assert.NotNull(byUpper);
        Assert.Equal(created.Id, byUpper!.Id);
    }

    [Fact]
    public async Task GetByUsernameAsync_ReturnsNull_WhenNoSuchUser()
    {
        var store = new SqliteUserStore(NewTempDir());
        Assert.Null(await store.GetByUsernameAsync("nobody"));
    }

    [Fact]
    public async Task PasswordHash_RoundTrips_ThroughPasswordHasher_SucceedsForCorrectPassword_FailsForWrong()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var hash = hasher.HashPassword(AppUser.Instance, "correct horse battery staple");
        await store.CreateAsync("bob", hash, Roles.Operator, null, createdBy: "test");

        var reloaded = await store.GetByUsernameAsync("bob");
        Assert.NotNull(reloaded);

        var okResult = hasher.VerifyHashedPassword(AppUser.Instance, reloaded!.PasswordHash, "correct horse battery staple");
        Assert.NotEqual(PasswordVerificationResult.Failed, okResult);

        var badResult = hasher.VerifyHashedPassword(AppUser.Instance, reloaded.PasswordHash, "wrong password");
        Assert.Equal(PasswordVerificationResult.Failed, badResult);
    }

    [Fact]
    public async Task SetPasswordHashAsync_OnlyBumpsStamp_WhenAsked()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var user = await store.CreateAsync("carol", hasher.HashPassword(AppUser.Instance, "pw1"), Roles.Engineer, null, createdBy: "test");
        var originalStamp = user.SecurityStamp;

        await store.SetPasswordHashAsync(user.Id, hasher.HashPassword(AppUser.Instance, "pw2"), bumpStamp: false);
        var afterNoBump = await store.GetByUsernameAsync("carol");
        Assert.Equal(originalStamp, afterNoBump!.SecurityStamp);

        await store.SetPasswordHashAsync(user.Id, hasher.HashPassword(AppUser.Instance, "pw3"), bumpStamp: true);
        var afterBump = await store.GetByUsernameAsync("carol");
        Assert.NotEqual(originalStamp, afterBump!.SecurityStamp);

        var verify = hasher.VerifyHashedPassword(AppUser.Instance, afterBump.PasswordHash, "pw3");
        Assert.NotEqual(PasswordVerificationResult.Failed, verify);
    }

    [Fact]
    public async Task SetRoleAsync_ChangesRole_AndBumpsStamp()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var user = await store.CreateAsync("dave", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Operator, null, createdBy: "test");

        await store.SetRoleAsync(user.Id, Roles.Engineer);

        var updated = await store.GetByUsernameAsync("dave");
        Assert.Equal(Roles.Engineer, updated!.Role);
        Assert.NotEqual(user.SecurityStamp, updated.SecurityStamp);
    }

    [Fact]
    public async Task SetDisabledAsync_DisablesUser_AndBumpsStamp()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var user = await store.CreateAsync("erin", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Operator, null, createdBy: "test");

        await store.SetDisabledAsync(user.Id, true);

        var updated = await store.GetByUsernameAsync("erin");
        Assert.True(updated!.Disabled);
        Assert.NotEqual(user.SecurityStamp, updated.SecurityStamp);
    }

    [Fact]
    public async Task SetLastLoginAsync_RecordsTimestamp()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var user = await store.CreateAsync("frank", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Operator, null, createdBy: "test");
        Assert.Null(user.LastLoginAtUtc);

        var now = DateTimeOffset.UtcNow;
        await store.SetLastLoginAsync(user.Id, now);

        var updated = await store.GetByUsernameAsync("frank");
        Assert.NotNull(updated!.LastLoginAtUtc);
        Assert.Equal(now.ToUniversalTime().ToString("O"), updated.LastLoginAtUtc!.Value.ToUniversalTime().ToString("O"));
    }

    [Fact]
    public async Task ListAsync_ReturnsAllUsers()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        await store.CreateAsync("gina", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Admin, null, createdBy: "test");
        await store.CreateAsync("hank", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Operator, null, createdBy: "test");

        var all = await store.ListAsync();
        Assert.Equal(2, all.Count);
    }

    [Fact]
    public async Task VerifySecurityStampAsync_TrueForMatch_FalseForMismatchOrDisabled()
    {
        var store = new SqliteUserStore(NewTempDir());
        var hasher = Hasher();
        var user = await store.CreateAsync("ivan", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Operator, null, createdBy: "test");

        Assert.True(await store.VerifySecurityStampAsync("ivan", user.SecurityStamp));
        Assert.False(await store.VerifySecurityStampAsync("ivan", "not-the-real-stamp"));

        await store.SetDisabledAsync(user.Id, true);
        var updated = await store.GetByUsernameAsync("ivan");
        Assert.False(await store.VerifySecurityStampAsync("ivan", updated!.SecurityStamp));
    }

    [Fact]
    public async Task ANewStore_PointedAtTheSameDirectory_SeesUsersCreatedByAnEarlierStore_RestartSurvival()
    {
        var tempDir = NewTempDir();
        var store1 = new SqliteUserStore(tempDir);
        var hasher = Hasher();
        var created = await store1.CreateAsync("judy", hasher.HashPassword(AppUser.Instance, "pw"), Roles.Admin, "Judy", createdBy: "test");

        var store2 = new SqliteUserStore(tempDir);
        var reloaded = await store2.GetByUsernameAsync("judy");

        Assert.NotNull(reloaded);
        Assert.Equal(created.Id, reloaded!.Id);
        Assert.Equal(created.SecurityStamp, reloaded.SecurityStamp);
        Assert.Equal(created.PasswordHash, reloaded.PasswordHash);
        Assert.Equal(1, await store2.CountAsync());
    }
}
