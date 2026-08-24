using System.Net.Mail;
using Lifewood.PlatformApi.Contracts;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal enum AccountCreateOutcome { Created, AlreadyInitialized, Invalid }
internal sealed record AccountCreateResult(AccountCreateOutcome Outcome, CurrentUserDto? User, string? Field = null);
internal enum AccountLoginOutcome { Success, InvalidCredentials, Locked }
internal sealed record AccountLoginResult(AccountLoginOutcome Outcome, CurrentUserDto? User, DateTimeOffset? LockedUntil = null);

internal sealed class UserRepository
{
    private const int LockoutThreshold = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private readonly string connectionString;
    private readonly string uploadsDirectory;
    private readonly PasswordHasher<AccountPasswordTarget> passwordHasher = new();
    private readonly string dummyPasswordHash;

    public UserRepository(string connectionString, string dataDirectory)
    {
        this.connectionString = connectionString;
        uploadsDirectory = Path.Combine(dataDirectory, "uploads");
        dummyPasswordHash = passwordHasher.HashPassword(new AccountPasswordTarget("dummy"), Guid.NewGuid().ToString("N"));
    }

    public void Initialize()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                normalized_email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_normalized_email ON users(normalized_email);
            """;
        command.ExecuteNonQuery();
    }

    public bool RequiresBootstrap()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT NOT EXISTS(SELECT 1 FROM users LIMIT 1);";
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }

    public AccountCreateResult CreateOwner(string displayName, string email, string password)
    {
        if (string.IsNullOrWhiteSpace(displayName)) return new(AccountCreateOutcome.Invalid, null, "displayName");
        if (string.IsNullOrWhiteSpace(email)) return new(AccountCreateOutcome.Invalid, null, "email");
        if (string.IsNullOrEmpty(password)) return new(AccountCreateOutcome.Invalid, null, "password");
        var normalizedDisplayName = displayName.Trim();
        var normalizedEmail = NormalizeEmail(email);
        if (normalizedDisplayName.Length is < 2 or > 100) return new(AccountCreateOutcome.Invalid, null, "displayName");
        if (email.Length > 254 || !IsValidEmail(email)) return new(AccountCreateOutcome.Invalid, null, "email");
        if (password.Length is < 12 or > 128) return new(AccountCreateOutcome.Invalid, null, "password");

        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using (var count = connection.CreateCommand())
        {
            count.Transaction = transaction;
            count.CommandText = "SELECT COUNT(*) FROM users;";
            if (Convert.ToInt32(count.ExecuteScalar()) != 0) return new(AccountCreateOutcome.AlreadyInitialized, null);
        }

        var id = Guid.NewGuid().ToString("N");
        var legacyOwners = LegacyOwners(connection, transaction, id);
        try
        {
            CopyLegacyUploads(legacyOwners, id);
            var now = DateTimeOffset.UtcNow;
            var target = new AccountPasswordTarget(id);
            using (var insert = connection.CreateCommand())
            {
                insert.Transaction = transaction;
                insert.CommandText = """
                    INSERT INTO users(id, email, normalized_email, display_name, password_hash, role, created_at, updated_at)
                    VALUES ($id, $email, $normalizedEmail, $displayName, $passwordHash, 'owner', $now, $now);
                    """;
                insert.Parameters.AddWithValue("$id", id);
                insert.Parameters.AddWithValue("$email", email.Trim());
                insert.Parameters.AddWithValue("$normalizedEmail", normalizedEmail);
                insert.Parameters.AddWithValue("$displayName", normalizedDisplayName);
                insert.Parameters.AddWithValue("$passwordHash", passwordHasher.HashPassword(target, password));
                insert.Parameters.AddWithValue("$now", now.ToString("O"));
                insert.ExecuteNonQuery();
            }
            using (var claim = connection.CreateCommand())
            {
                claim.Transaction = transaction;
                claim.CommandText = "UPDATE projects SET owner_id = $ownerId WHERE owner_id <> $ownerId;";
                claim.Parameters.AddWithValue("$ownerId", id);
                claim.ExecuteNonQuery();
            }
            transaction.Commit();
            return new(AccountCreateOutcome.Created, ToCurrentUser(id, email.Trim(), normalizedDisplayName, "owner"));
        }
        catch
        {
            var ownerRoot = Path.Combine(uploadsDirectory, id);
            if (Directory.Exists(ownerRoot)) Directory.Delete(ownerRoot, recursive: true);
            throw;
        }
    }

    public AccountLoginResult Authenticate(string email, string password)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254 || string.IsNullOrEmpty(password) || password.Length > 128)
            return new(AccountLoginOutcome.InvalidCredentials, null);

        var normalizedEmail = NormalizeEmail(email);
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        var account = FindByNormalizedEmail(connection, transaction, normalizedEmail);
        if (account is null)
        {
            transaction.Rollback();
            passwordHasher.VerifyHashedPassword(new AccountPasswordTarget("dummy"), dummyPasswordHash, password);
            return new(AccountLoginOutcome.InvalidCredentials, null);
        }

        if (!account.Active)
        {
            transaction.Rollback();
            passwordHasher.VerifyHashedPassword(new AccountPasswordTarget("dummy"), dummyPasswordHash, password);
            return new(AccountLoginOutcome.InvalidCredentials, null);
        }
        var now = DateTimeOffset.UtcNow;
        if (account.LockedUntil is { } lockedUntil && lockedUntil > now)
        {
            transaction.Rollback();
            passwordHasher.VerifyHashedPassword(new AccountPasswordTarget("dummy"), dummyPasswordHash, password);
            return new(AccountLoginOutcome.Locked, null, lockedUntil);
        }

        var attempts = account.LockedUntil is not null ? 0 : account.FailedAttempts;
        var verification = passwordHasher.VerifyHashedPassword(new AccountPasswordTarget(account.Id), account.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
        {
            attempts++;
            var nextLockout = attempts >= LockoutThreshold ? now.Add(LockoutDuration) : (DateTimeOffset?)null;
            UpdateLoginState(connection, transaction, account.Id, attempts, nextLockout, null);
            transaction.Commit();
            return nextLockout is null
                ? new(AccountLoginOutcome.InvalidCredentials, null)
                : new(AccountLoginOutcome.Locked, null, nextLockout);
        }

        var replacementHash = verification == PasswordVerificationResult.SuccessRehashNeeded
            ? passwordHasher.HashPassword(new AccountPasswordTarget(account.Id), password)
            : null;
        UpdateLoginState(connection, transaction, account.Id, 0, null, replacementHash);
        transaction.Commit();
        return new(AccountLoginOutcome.Success, ToCurrentUser(account.Id, account.Email, account.DisplayName, account.Role));
    }

    public CurrentUserDto? Get(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, email, display_name, role FROM users WHERE id = $id AND is_active = 1;";
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ToCurrentUser(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)) : null;
    }

    private static string[] LegacyOwners(SqliteConnection connection, SqliteTransaction transaction, string newOwnerId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT DISTINCT owner_id FROM projects WHERE owner_id <> $ownerId;";
        command.Parameters.AddWithValue("$ownerId", newOwnerId);
        using var reader = command.ExecuteReader();
        var owners = new List<string>();
        while (reader.Read()) owners.Add(reader.GetString(0));
        return [.. owners];
    }

    private void CopyLegacyUploads(string[] legacyOwners, string newOwnerId)
    {
        if (legacyOwners.Length == 0 || !Directory.Exists(uploadsDirectory)) return;
        var destinationRoot = Path.Combine(uploadsDirectory, newOwnerId);
        foreach (var legacyOwner in legacyOwners)
        {
            var sourceRoot = Path.Combine(uploadsDirectory, legacyOwner);
            if (!Directory.Exists(sourceRoot)) continue;
            foreach (var sourceDirectory in Directory.EnumerateDirectories(sourceRoot))
            {
                var destination = Path.Combine(destinationRoot, Path.GetFileName(sourceDirectory));
                if (Directory.Exists(destination)) throw new IOException($"The legacy project upload directory already exists at {destination}.");
                CopyDirectory(sourceDirectory, destination);
            }
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        foreach (var directory in Directory.EnumerateDirectories(source)) CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private static StoredAccount? FindByNormalizedEmail(SqliteConnection connection, SqliteTransaction transaction, string normalizedEmail)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT id, email, display_name, password_hash, role, failed_attempts, locked_until, is_active FROM users WHERE normalized_email = $email;";
        command.Parameters.AddWithValue("$email", normalizedEmail);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new StoredAccount(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5),
            reader.IsDBNull(6) ? null : DateTimeOffset.Parse(reader.GetString(6)), reader.GetInt32(7) == 1);
    }

    private static void UpdateLoginState(SqliteConnection connection, SqliteTransaction transaction, string id, int attempts, DateTimeOffset? lockedUntil, string? passwordHash)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE users
            SET failed_attempts = $attempts, locked_until = $lockedUntil,
                password_hash = COALESCE($passwordHash, password_hash), updated_at = $now
            WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$attempts", attempts);
        command.Parameters.AddWithValue("$lockedUntil", lockedUntil is null ? DBNull.Value : lockedUntil.Value.ToString("O"));
        command.Parameters.AddWithValue("$passwordHash", passwordHash is null ? DBNull.Value : passwordHash);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private static string NormalizeEmail(string value) => value.Trim().ToUpperInvariant();
    private static bool IsValidEmail(string value) => MailAddress.TryCreate(value.Trim(), out var address) && address.Address.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase);
    private static CurrentUserDto ToCurrentUser(string id, string email, string displayName, string role)
    {
        var permissions = role switch
        {
            "owner" => new[] { "tasks.read", "tasks.write", "tasks.submit", "admin.access", "admin.projects.manage", "admin.users.manage", "admin.config.manage" },
            "admin" => new[] { "admin.access", "admin.projects.manage", "admin.users.manage", "admin.config.manage" },
            _ => new[] { "tasks.read", "tasks.write", "tasks.submit" }
        };
        return new(id, email, displayName, $"/api/me/avatar?v={Uri.EscapeDataString(id)}", email, null, [role], permissions, null, null);
    }

    private sealed record AccountPasswordTarget(string Id);
    private sealed record StoredAccount(string Id, string Email, string DisplayName, string PasswordHash, string Role, int FailedAttempts, DateTimeOffset? LockedUntil, bool Active);
}
