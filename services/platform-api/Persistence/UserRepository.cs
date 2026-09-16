using System.Net.Mail;
using Lifewood.PlatformApi.Contracts;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal enum AccountCreateOutcome { Created, AlreadyInitialized, Invalid }
internal sealed record AccountCreateResult(AccountCreateOutcome Outcome, CurrentUserDto? User, string? Field = null);
internal enum AccountLoginOutcome { Success, InvalidCredentials, Locked }
internal sealed record AccountLoginResult(AccountLoginOutcome Outcome, CurrentUserDto? User, DateTimeOffset? LockedUntil = null);
internal enum ProfileUpdateOutcome { Updated, Invalid, NotFound }
internal sealed record ProfileUpdateResult(ProfileUpdateOutcome Outcome, CurrentUserDto? User = null, string? Field = null);
internal enum PasswordUpdateOutcome { Updated, Invalid, NotFound }
internal sealed record PasswordUpdateResult(PasswordUpdateOutcome Outcome, string? Field = null);
internal sealed record StoredAvatar(FileStream Stream, string ContentType);

internal sealed class UserRepository
{
    private const int LockoutThreshold = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private readonly string connectionString;
    private readonly string uploadsDirectory;
    private readonly string avatarDirectory;
    private readonly PasswordHasher<AccountPasswordTarget> passwordHasher = new();
    private readonly string dummyPasswordHash;

    public UserRepository(string connectionString, string dataDirectory)
    {
        this.connectionString = connectionString;
        uploadsDirectory = Path.Combine(dataDirectory, "uploads");
        avatarDirectory = Path.Combine(dataDirectory, "avatars");
        dummyPasswordHash = passwordHasher.HashPassword(new AccountPasswordTarget("dummy"), Guid.NewGuid().ToString("N"));
    }

    public void Initialize()
    {
        using var connection = Open();
        OrganizationSchema.EnsureOrganizationTable(connection);
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                normalized_email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                client_name TEXT NULL,
                phone TEXT NULL,
                locale TEXT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT NULL,
                session_version INTEGER NOT NULL DEFAULT 0,
                avatar_file_name TEXT NULL,
                organization_id TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_normalized_email ON users(normalized_email);
            """;
        command.ExecuteNonQuery();
        if (!HasColumn(connection, "users", "session_version")) Execute(connection, "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;");
        if (!HasColumn(connection, "users", "is_active")) Execute(connection, "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
        if (!HasColumn(connection, "users", "avatar_file_name")) Execute(connection, "ALTER TABLE users ADD COLUMN avatar_file_name TEXT NULL;");
        if (!HasColumn(connection, "users", "phone")) Execute(connection, "ALTER TABLE users ADD COLUMN phone TEXT NULL;");
        if (!HasColumn(connection, "users", "client_name")) Execute(connection, "ALTER TABLE users ADD COLUMN client_name TEXT NULL;");
        if (!HasColumn(connection, "users", "task_background_motion")) Execute(connection, "ALTER TABLE users ADD COLUMN task_background_motion INTEGER NOT NULL DEFAULT 1;");
        if (!HasColumn(connection, "users", "locale")) Execute(connection, "ALTER TABLE users ADD COLUMN locale TEXT NULL;");
        if (!HasColumn(connection, "users", "closed_at")) Execute(connection, "ALTER TABLE users ADD COLUMN closed_at TEXT NULL;");
        OrganizationSchema.Ensure(connection);
        CleanupAvatarDirectory(connection);
    }

    public bool RequiresBootstrap()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT NOT EXISTS(SELECT 1 FROM users LIMIT 1);";
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }

    public AccountCreateResult CreateOwner(string displayName, string email, string password, string? phone = null, string? organizationName = null, string? locale = null)
    {
        if (string.IsNullOrWhiteSpace(displayName)) return new(AccountCreateOutcome.Invalid, null, "displayName");
        if (string.IsNullOrWhiteSpace(email)) return new(AccountCreateOutcome.Invalid, null, "email");
        if (string.IsNullOrEmpty(password)) return new(AccountCreateOutcome.Invalid, null, "password");
        var normalizedDisplayName = displayName.Trim();
        var normalizedEmail = NormalizeEmail(email);
        var normalizedPhone = NormalizePhone(phone);
        var normalizedLocale = NormalizeLocale(locale);
        var normalizedOrganizationName = string.IsNullOrWhiteSpace(organizationName) ? null : organizationName.Trim();
        var normalizedClientName = normalizedOrganizationName ?? normalizedDisplayName;
        if (normalizedDisplayName.Length is < 2 or > 100) return new(AccountCreateOutcome.Invalid, null, "displayName");
        if (email.Length > 254 || !IsValidEmail(email)) return new(AccountCreateOutcome.Invalid, null, "email");
        if (password.Length is < 8 or > 128) return new(AccountCreateOutcome.Invalid, null, "password");
        if (normalizedPhone is { Length: > 50 }) return new(AccountCreateOutcome.Invalid, null, "phone");
        if (normalizedOrganizationName is { Length: < 2 or > 120 }) return new(AccountCreateOutcome.Invalid, null, "organizationName");
        if (locale is not null && normalizedLocale is null) return new(AccountCreateOutcome.Invalid, null, "locale");

        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using (var count = connection.CreateCommand())
        {
            count.Transaction = transaction;
            count.CommandText = "SELECT COUNT(*) FROM users;";
            if (Convert.ToInt32(count.ExecuteScalar()) != 0) return new(AccountCreateOutcome.AlreadyInitialized, null);
        }

        var id = Guid.NewGuid().ToString("N");
        var organizationId = normalizedOrganizationName is null ? null : Guid.NewGuid().ToString("N");
        var legacyOwners = LegacyOwners(connection, transaction, id);
        try
        {
            CopyLegacyUploads(legacyOwners, id);
            var now = DateTimeOffset.UtcNow;
            var target = new AccountPasswordTarget(id);
            if (organizationId is not null)
            {
                using var organization = connection.CreateCommand();
                organization.Transaction = transaction;
                organization.CommandText = "INSERT INTO organizations(id, name, normalized_name, is_active, created_at, updated_at) VALUES ($id, $name, $normalizedName, 1, $now, $now);";
                organization.Parameters.AddWithValue("$id", organizationId);
                organization.Parameters.AddWithValue("$name", normalizedOrganizationName!);
                organization.Parameters.AddWithValue("$normalizedName", normalizedOrganizationName!.ToUpperInvariant());
                organization.Parameters.AddWithValue("$now", now.ToString("O"));
                organization.ExecuteNonQuery();
            }
            using (var insert = connection.CreateCommand())
            {
                insert.Transaction = transaction;
                insert.CommandText = """
                    INSERT INTO users(id, email, normalized_email, display_name, client_name, phone, locale, password_hash, role, organization_id, created_at, updated_at)
                    VALUES ($id, $email, $normalizedEmail, $displayName, $clientName, $phone, $locale, $passwordHash, 'owner', $organizationId, $now, $now);
                    """;
                insert.Parameters.AddWithValue("$id", id);
                insert.Parameters.AddWithValue("$email", email.Trim());
                insert.Parameters.AddWithValue("$normalizedEmail", normalizedEmail);
                insert.Parameters.AddWithValue("$displayName", normalizedDisplayName);
                insert.Parameters.AddWithValue("$clientName", normalizedClientName);
                insert.Parameters.AddWithValue("$phone", normalizedPhone is null ? DBNull.Value : normalizedPhone);
                insert.Parameters.AddWithValue("$locale", normalizedLocale is null ? DBNull.Value : normalizedLocale);
                insert.Parameters.AddWithValue("$passwordHash", passwordHasher.HashPassword(target, password));
                insert.Parameters.AddWithValue("$organizationId", organizationId is null ? DBNull.Value : organizationId);
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
            return new(AccountCreateOutcome.Created, ToCurrentUser(id, email.Trim(), normalizedDisplayName, "owner", null, organizationId, normalizedOrganizationName, normalizedPhone, normalizedLocale, normalizedClientName));
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
        var authenticated=Get(account.Id);
        return authenticated is null?new(AccountLoginOutcome.InvalidCredentials,null):new(AccountLoginOutcome.Success,authenticated);
    }

    public CurrentUserDto? Get(string id, int? sessionVersion = null)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT u.id, u.email, u.display_name, u.role, u.avatar_file_name, o.id, o.name, u.phone, u.locale, u.client_name, u.task_background_motion
            FROM users u
            LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE u.id = $id AND u.is_active = 1 AND ($sessionVersion IS NULL OR u.session_version = $sessionVersion);
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$sessionVersion", sessionVersion is null ? DBNull.Value : sessionVersion.Value);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ToCurrentUser(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7), reader.IsDBNull(8) ? null : reader.GetString(8), reader.IsDBNull(9) ? null : reader.GetString(9), reader.GetInt32(10) != 0) : null;
    }

    public ProfileUpdateResult UpdateProfile(string id, string displayName, string? phone)
    {
        if (string.IsNullOrWhiteSpace(displayName)) return new(ProfileUpdateOutcome.Invalid, Field: "displayName");
        var normalizedDisplayName = displayName.Trim();
        var normalizedPhone = NormalizePhone(phone);
        if (normalizedDisplayName.Length is < 2 or > 100) return new(ProfileUpdateOutcome.Invalid, Field: "displayName");
        if (normalizedPhone is { Length: > 50 }) return new(ProfileUpdateOutcome.Invalid, Field: "phone");

        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE users SET display_name = $displayName, phone = $phone, updated_at = $now WHERE id = $id AND is_active = 1;";
        command.Parameters.AddWithValue("$displayName", normalizedDisplayName);
        command.Parameters.AddWithValue("$phone", normalizedPhone is null ? DBNull.Value : normalizedPhone);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        if (command.ExecuteNonQuery() == 0) return new(ProfileUpdateOutcome.NotFound);
        var updated = Get(id);
        return updated is null ? new(ProfileUpdateOutcome.NotFound) : new(ProfileUpdateOutcome.Updated, updated);
    }

    public ProfileUpdateResult UpdatePreferences(string id, string locale, bool? taskBackgroundMotion = null)
    {
        var normalizedLocale = NormalizeLocale(locale);
        if (normalizedLocale is null) return new(ProfileUpdateOutcome.Invalid, Field: "locale");
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE users SET locale = $locale, task_background_motion = COALESCE($motion, task_background_motion), updated_at = $now WHERE id = $id AND is_active = 1;";
        command.Parameters.AddWithValue("$locale", normalizedLocale);
        command.Parameters.AddWithValue("$motion", taskBackgroundMotion is null ? DBNull.Value : taskBackgroundMotion.Value ? 1 : 0);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        if (command.ExecuteNonQuery() == 0) return new(ProfileUpdateOutcome.NotFound);
        var updated = Get(id);
        return updated is null ? new(ProfileUpdateOutcome.NotFound) : new(ProfileUpdateOutcome.Updated, updated);
    }

    public StoredAvatar? OpenAvatar(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT avatar_file_name FROM users WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id);
        var fileName = command.ExecuteScalar() as string;
        if (string.IsNullOrWhiteSpace(fileName) || Path.GetFileName(fileName) != fileName) return null;
        var path = Path.Combine(avatarDirectory, fileName);
        if (!File.Exists(path)) return null;
        var contentType = Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".jpg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => null
        };
        try
        {
            return contentType is null ? null : new(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), contentType);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
    }

    public async Task<CurrentUserDto?> SaveAvatar(string id, Stream source, string extension, CancellationToken cancellationToken)
    {
        if (extension is not (".jpg" or ".png" or ".webp")) return null;
        Directory.CreateDirectory(avatarDirectory);
        var fileName = $"{id}-{Guid.NewGuid():N}{extension}";
        var target = Path.Combine(avatarDirectory, fileName);
        var temporary = target + ".uploading";
        string? previousFileName;
        try
        {
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await source.CopyToAsync(output, cancellationToken);
                await output.FlushAsync(cancellationToken);
            }
            File.Move(temporary, target);
            using var connection = Open();
            using var transaction = connection.BeginTransaction(deferred: false);
            using var find = connection.CreateCommand();
            find.Transaction = transaction;
            find.CommandText = "SELECT avatar_file_name FROM users WHERE id = $id AND is_active = 1;";
            find.Parameters.AddWithValue("$id", id);
            var previousValue = find.ExecuteScalar();
            if (previousValue is null) throw new InvalidOperationException("The user is no longer available.");
            previousFileName = previousValue is DBNull ? null : (string)previousValue;
            using var update = connection.CreateCommand();
            update.Transaction = transaction;
            update.CommandText = "UPDATE users SET avatar_file_name = $fileName, updated_at = $now WHERE id = $id AND is_active = 1;";
            update.Parameters.AddWithValue("$fileName", fileName);
            update.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            update.Parameters.AddWithValue("$id", id);
            if (update.ExecuteNonQuery() != 1) throw new InvalidOperationException("The user is no longer available.");
            transaction.Commit();
        }
        catch
        {
            if (File.Exists(temporary)) File.Delete(temporary);
            if (File.Exists(target)) File.Delete(target);
            throw;
        }
        TryDeleteAvatarFile(previousFileName);
        return Get(id);
    }

    public CurrentUserDto? RemoveAvatar(string id)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using var find = connection.CreateCommand();
        find.Transaction = transaction;
        find.CommandText = "SELECT avatar_file_name FROM users WHERE id = $id AND is_active = 1;";
        find.Parameters.AddWithValue("$id", id);
        var previousValue = find.ExecuteScalar();
        if (previousValue is null) return null;
        var previousFileName = previousValue is DBNull ? null : (string)previousValue;
        using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = "UPDATE users SET avatar_file_name = NULL, updated_at = $now WHERE id = $id AND is_active = 1;";
        update.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        update.Parameters.AddWithValue("$id", id);
        update.ExecuteNonQuery();
        transaction.Commit();
        TryDeleteAvatarFile(previousFileName);
        return Get(id);
    }

    private void TryDeleteAvatarFile(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || Path.GetFileName(fileName) != fileName) return;
        var path = Path.Combine(avatarDirectory, fileName);
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public void CleanupClosedAvatar(string? fileName) { if(fileName is not null) TryDeleteAvatarFile(fileName); }

    private void CleanupAvatarDirectory(SqliteConnection connection)
    {
        if (!Directory.Exists(avatarDirectory)) return;
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT avatar_file_name FROM users WHERE avatar_file_name IS NOT NULL;";
            using var reader = command.ExecuteReader();
            while (reader.Read()) referenced.Add(reader.GetString(0));
        }
        foreach (var path in Directory.EnumerateFiles(avatarDirectory))
        {
            var fileName = Path.GetFileName(path);
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            if (!fileName.EndsWith(".uploading", StringComparison.OrdinalIgnoreCase) &&
                (extension is not (".jpg" or ".png" or ".webp") || referenced.Contains(fileName))) continue;
            TryDeleteAvatarFile(fileName);
        }
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
        command.CommandText = """
            SELECT u.id, u.email, u.display_name, u.password_hash, u.role, u.failed_attempts, u.locked_until, u.is_active, u.avatar_file_name, o.id, o.name, u.phone, u.locale, u.client_name, u.task_background_motion
            FROM users u
            LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE u.normalized_email = $email;
            """;
        command.Parameters.AddWithValue("$email", normalizedEmail);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new StoredAccount(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5),
            reader.IsDBNull(6) ? null : DateTimeOffset.Parse(reader.GetString(6)), reader.GetInt32(7) == 1, reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9), reader.IsDBNull(10) ? null : reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetString(11),
            reader.IsDBNull(12) ? null : reader.GetString(12), reader.IsDBNull(13) ? null : reader.GetString(13));
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
    private static string? NormalizePhone(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string? NormalizeLocale(string? value)
    {
        var normalized = value?.Trim();
        return normalized is "zh-CN" or "en-US" ? normalized : null;
    }
    private static bool IsValidEmail(string value) => MailAddress.TryCreate(value.Trim(), out var address) && address.Address.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase);
    private static CurrentUserDto ToCurrentUser(string id, string email, string displayName, string role, string? avatarFileName, string? organizationId, string? organizationName, string? phone = null, string? locale = null, string? clientName = null, bool taskBackgroundMotion = true)
    {
        var permissions = role switch
        {
            "owner" => new[] { "tasks.read", "tasks.write", "tasks.submit", "admin.access", "admin.projects.manage", "admin.projects.read", "admin.projects.workflow", "admin.projects.assign", "admin.projects.return", "admin.projects.reply", "admin.projects.note", "admin.projects.deliver", "admin.projects.export", "admin.overview.read", "admin.audit.read", "admin.users.manage", "admin.feedback.manage", "admin.config.manage", "admin.runtime.manage" },
            "admin" => new[] { "admin.access", "admin.projects.manage", "admin.projects.read", "admin.projects.workflow", "admin.projects.assign", "admin.projects.return", "admin.projects.reply", "admin.projects.note", "admin.projects.deliver", "admin.projects.export", "admin.overview.read", "admin.audit.read", "admin.users.manage", "admin.feedback.manage", "admin.config.manage" },
            "operator" => new[] { "admin.access", "admin.projects.read", "admin.projects.workflow", "admin.projects.return", "admin.projects.reply", "admin.projects.note", "admin.projects.deliver", "admin.projects.export" },
            "customer" => new[] { "tasks.read", "tasks.write", "tasks.submit" },
            _ => Array.Empty<string>()
        };
        var avatarVersion = avatarFileName ?? id;
        var organization = organizationId is not null && organizationName is not null ? new OrganizationDto(organizationId, organizationName) : null;
        return new(id, email, displayName, $"/api/me/avatar?v={Uri.EscapeDataString(avatarVersion)}", email, organization, [role], permissions, locale, null, avatarFileName is not null, phone, clientName, taskBackgroundMotion);
    }

    private static bool ValidNewPassword(string password) => !string.IsNullOrEmpty(password) && password.Length is >= 8 and <= 128;

    internal void ApplyEmailPasswordReset(SqliteConnection connection, SqliteTransaction transaction, string id, string password) => UpdatePassword(connection, transaction, id, password);

    private void UpdatePassword(SqliteConnection connection, SqliteTransaction transaction, string id, string password)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE users SET password_hash = $hash, failed_attempts = 0, locked_until = NULL, session_version = session_version + 1, updated_at = $now WHERE id = $id;";
        command.Parameters.AddWithValue("$hash", passwordHasher.HashPassword(new AccountPasswordTarget(id), password));
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.ExecuteNonQuery();
    }

    private static bool HasColumn(SqliteConnection connection, string table, string column)
    { using var command = connection.CreateCommand(); command.CommandText = $"PRAGMA table_info({table});"; using var reader = command.ExecuteReader(); while (reader.Read()) if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true; return false; }

    private static void Execute(SqliteConnection connection, string sql)
    { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private sealed record AccountPasswordTarget(string Id);
    private sealed record StoredAccount(string Id, string Email, string DisplayName, string PasswordHash, string Role, int FailedAttempts, DateTimeOffset? LockedUntil, bool Active, string? AvatarFileName, string? OrganizationId, string? OrganizationName, string? Phone, string? Locale, string? ClientName);
    public PasswordUpdateResult ChangePassword(string id, string currentPassword, string newPassword)
    {
        if (string.IsNullOrEmpty(currentPassword) || currentPassword.Length > 128) return new(PasswordUpdateOutcome.Invalid, "currentPassword");
        if (!ValidNewPassword(newPassword)) return new(PasswordUpdateOutcome.Invalid, "newPassword");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using var find = connection.CreateCommand();
        find.Transaction = transaction;
        find.CommandText = "SELECT password_hash FROM users WHERE id = $id AND is_active = 1;";
        find.Parameters.AddWithValue("$id", id);
        var storedHash = find.ExecuteScalar() as string;
        if (storedHash is null) return new(PasswordUpdateOutcome.NotFound);
        if (passwordHasher.VerifyHashedPassword(new AccountPasswordTarget(id), storedHash, currentPassword) == PasswordVerificationResult.Failed)
            return new(PasswordUpdateOutcome.Invalid, "currentPassword");
        UpdatePassword(connection, transaction, id, newPassword);
        transaction.Commit();
        return new(PasswordUpdateOutcome.Updated);
    }

    public PasswordUpdateResult ResetPassword(string id, string newPassword)
    {
        if (!ValidNewPassword(newPassword)) return new(PasswordUpdateOutcome.Invalid, "newPassword");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using var exists = connection.CreateCommand();
        exists.Transaction = transaction;
        exists.CommandText = "SELECT COUNT(*) FROM users WHERE id = $id AND closed_at IS NULL;";
        exists.Parameters.AddWithValue("$id", id);
        if (Convert.ToInt32(exists.ExecuteScalar()) != 1) return new(PasswordUpdateOutcome.NotFound);
        UpdatePassword(connection, transaction, id, newPassword);
        transaction.Commit();
        return new(PasswordUpdateOutcome.Updated);
    }

    public int? GetSessionVersion(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT session_version FROM users WHERE id = $id AND is_active = 1;";
        command.Parameters.AddWithValue("$id", id);
        var value = command.ExecuteScalar();
        return value is null or DBNull ? null : Convert.ToInt32(value);
    }

}
