using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D1 — <see cref="IUserStore"/> over <see cref="SecurityDb"/>'s <c>users</c> table, raw
/// <c>Microsoft.Data.Sqlite</c>, parameterized SQL only (no string-built values ever reach a
/// <c>CommandText</c> literal). Same "every public method opens a short-lived connection, no state held
/// across calls" shape as <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/>.
/// </summary>
public sealed class SqliteUserStore : IUserStore
{
    private readonly SecurityDb _db;

    /// <summary>Test/diagnostic seam — the on-disk path this instance actually opened.</summary>
    public string DbPath => _db.DbPath;

    /// <param name="directory">Explicit directory override (tests use a temp dir here); <see langword="null"/>
    /// resolves via <c>ST4I_SECURITY_DIR</c> then the default <c>%ProgramData%\ST4I\sim\security</c> root
    /// (see <see cref="SecurityDb.ResolveRoot"/>).</param>
    public SqliteUserStore(string? directory = null)
    {
        _db = new SecurityDb(directory);
    }

    private const string Columns = """
        id, username, password_hash, role, display_name, disabled, must_change_password,
        security_stamp, created_at_utc, created_by, last_login_at_utc
        """;

    public async Task<int> CountAsync(CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM users;";
        return Convert.ToInt32((long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture);
    }

    public async Task<UserRecord?> GetByUsernameAsync(string username, CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users WHERE username = @username;";
        cmd.Parameters.AddWithValue("@username", username);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        return await reader.ReadAsync(ct).ConfigureAwait(false) ? ReadRow(reader) : null;
    }

    public async Task<UserRecord> CreateAsync(string username, string passwordHash, string role, string? displayName, string? createdBy, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var stamp = Guid.NewGuid().ToString("N");

        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);

        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO users
                    (username, password_hash, role, display_name, disabled, must_change_password,
                     security_stamp, created_at_utc, created_by, last_login_at_utc)
                VALUES
                    (@username, @password_hash, @role, @display_name, 0, 0,
                     @security_stamp, @created_at_utc, @created_by, NULL);
                """;
            cmd.Parameters.AddWithValue("@username", username);
            cmd.Parameters.AddWithValue("@password_hash", passwordHash);
            cmd.Parameters.AddWithValue("@role", role);
            cmd.Parameters.AddWithValue("@display_name", (object?)displayName ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@security_stamp", stamp);
            cmd.Parameters.AddWithValue("@created_at_utc", ToIso(now));
            cmd.Parameters.AddWithValue("@created_by", (object?)createdBy ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        long id;
        using (var idCmd = connection.CreateCommand())
        {
            idCmd.CommandText = "SELECT last_insert_rowid();";
            id = (long)(await idCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        return new UserRecord((int)id, username, passwordHash, role, displayName, false, false, stamp, now, createdBy, null);
    }

    public async Task SetPasswordHashAsync(int id, string passwordHash, bool bumpStamp, CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        if (bumpStamp)
        {
            cmd.CommandText = "UPDATE users SET password_hash = @hash, security_stamp = @stamp WHERE id = @id;";
            cmd.Parameters.AddWithValue("@stamp", Guid.NewGuid().ToString("N"));
        }
        else
        {
            cmd.CommandText = "UPDATE users SET password_hash = @hash WHERE id = @id;";
        }
        cmd.Parameters.AddWithValue("@hash", passwordHash);
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public async Task SetRoleAsync(int id, string role, CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "UPDATE users SET role = @role, security_stamp = @stamp WHERE id = @id;";
        cmd.Parameters.AddWithValue("@role", role);
        cmd.Parameters.AddWithValue("@stamp", Guid.NewGuid().ToString("N"));
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public async Task SetDisabledAsync(int id, bool disabled, CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "UPDATE users SET disabled = @disabled, security_stamp = @stamp WHERE id = @id;";
        cmd.Parameters.AddWithValue("@disabled", disabled ? 1 : 0);
        cmd.Parameters.AddWithValue("@stamp", Guid.NewGuid().ToString("N"));
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public async Task SetLastLoginAsync(int id, DateTimeOffset atUtc, CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "UPDATE users SET last_login_at_utc = @at WHERE id = @id;";
        cmd.Parameters.AddWithValue("@at", ToIso(atUtc));
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<UserRecord>> ListAsync(CancellationToken ct = default)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users ORDER BY id;";

        var results = new List<UserRecord>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadRow(reader));
        }
        return results;
    }

    public async Task<bool> VerifySecurityStampAsync(string username, string stamp, CancellationToken ct = default)
    {
        var user = await GetByUsernameAsync(username, ct).ConfigureAwait(false);
        return user is not null && !user.Disabled && string.Equals(user.SecurityStamp, stamp, StringComparison.Ordinal);
    }

    private static UserRecord ReadRow(SqliteDataReader reader) => new(
        Id: reader.GetInt32(reader.GetOrdinal("id")),
        Username: reader.GetString(reader.GetOrdinal("username")),
        PasswordHash: reader.GetString(reader.GetOrdinal("password_hash")),
        Role: reader.GetString(reader.GetOrdinal("role")),
        DisplayName: GetNullableString(reader, "display_name"),
        Disabled: reader.GetInt64(reader.GetOrdinal("disabled")) != 0,
        MustChangePassword: reader.GetInt64(reader.GetOrdinal("must_change_password")) != 0,
        SecurityStamp: reader.GetString(reader.GetOrdinal("security_stamp")),
        CreatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("created_at_utc"))),
        CreatedBy: GetNullableString(reader, "created_by"),
        LastLoginAtUtc: GetNullableString(reader, "last_login_at_utc") is { } s ? ParseIso(s) : null);

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
