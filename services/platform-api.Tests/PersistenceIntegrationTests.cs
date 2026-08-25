using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class PersistenceIntegrationTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-platform-tests-" + Guid.NewGuid().ToString("N"));
    private string ConnectionString => "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";

    public PersistenceIntegrationTests() => Directory.CreateDirectory(root);

    [Fact]
    public void UserMigrationAndPasswordUpdatesRevokeOldSessionVersions()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();

        Execute("ALTER TABLE users DROP COLUMN session_version;");
        users.Initialize();
        Assert.True(HasColumn("users", "session_version"));

        var created = users.CreateOwner("Owner", "owner@example.test", "initial-password-123");
        Assert.Equal(AccountCreateOutcome.Created, created.Outcome);
        var user = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(created.User);
        Assert.Equal(0, users.GetSessionVersion(user.Id));

        var changed = users.ChangePassword(user.Id, "initial-password-123", "updated-password-456");
        Assert.Equal(PasswordUpdateOutcome.Updated, changed.Outcome);
        Assert.Null(users.Get(user.Id, 0));
        Assert.NotNull(users.Get(user.Id, 1));

        var reset = users.ResetPassword(user.Id, "reset-password-789");
        Assert.Equal(PasswordUpdateOutcome.Updated, reset.Outcome);
        Assert.Null(users.Get(user.Id, 1));
        Assert.NotNull(users.Get(user.Id, 2));
    }

    [Fact]
    public void RevokingLastDeliveryHidesFileAndRestoresProductionWorkflow()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(
            users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'in_production' WHERE id = $id;", ("$id", draft.Id));

        var deliveries = new DeliveryRepository(ConnectionString);
        deliveries.Initialize();
        Execute("ALTER TABLE project_deliveries DROP COLUMN revoked_at;");
        deliveries.Initialize();
        Assert.True(HasColumn("project_deliveries", "revoked_at"));

        var publish = deliveries.Publish("delivery-1", draft.Id, owner.Id, "final.mp4", "video/mp4", 42, "Ready", out var delivery);
        Assert.Equal(AdminWriteOutcome.Saved, publish.Outcome);
        Assert.NotNull(delivery);
        Assert.Equal("completed", Scalar("SELECT workflow_status FROM projects WHERE id = $id;", ("$id", draft.Id)));
        Assert.Single(deliveries.List(draft.Id));

        var revoke = deliveries.Revoke(draft.Id, "delivery-1");
        Assert.Equal(AdminWriteOutcome.Saved, revoke.Outcome);
        Assert.Empty(deliveries.List(draft.Id));
        Assert.Null(deliveries.Find(draft.Id, "delivery-1"));
        Assert.NotNull(Assert.Single(deliveries.ListForAdmin(draft.Id)).RevokedAt);
        Assert.Equal("in_production", Scalar("SELECT workflow_status FROM projects WHERE id = $id;", ("$id", draft.Id)));
    }

    [Fact]
    public void PlatformLockPreventsConcurrentWriter()
    {
        var path = Path.Combine(root, "platform.lock");
        using (File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            Assert.Throws<IOException>(() => File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
        using var reopened = File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        Assert.True(reopened.CanWrite);
    }

    private bool HasColumn(string table, string column)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA table_info(" + table + ");";
        using var reader = command.ExecuteReader();
        while (reader.Read()) if (reader.GetString(1) == column) return true;
        return false;
    }

    private void Execute(string sql, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        command.ExecuteNonQuery();
    }

    private string? Scalar(string sql, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        return command.ExecuteScalar() as string;
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
