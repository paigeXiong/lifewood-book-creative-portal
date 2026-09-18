using System.Security.Cryptography;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class EmailRepository(string connectionString, IDataProtectionProvider protection, MailSettings settings, UserRepository users, NotificationRepository notifications)
{
    public MailTemplateStore Templates { get; } = new(connectionString);
    private readonly IDataProtector protector = protection.CreateProtector("BookCreativePortal.EmailOutbox.v1");
    private readonly SemaphoreSlim deliveryLock = new(1, 1);
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    private static SqliteCommand Cmd(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] values)
    { var q = c.CreateCommand(); q.Transaction = tx; q.CommandText = sql; foreach (var (key, value) in values) q.Parameters.AddWithValue(key, value ?? DBNull.Value); return q; }
    private static void Exec(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] values) { using var q = Cmd(c, tx, sql, values); q.ExecuteNonQuery(); }
    public void Initialize()
    {
        Templates.Initialize();
        using var c = Open(); Exec(c, null, """
        CREATE TABLE IF NOT EXISTS email_settings(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,notifications INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS email_notification_scope(user_id TEXT PRIMARY KEY,topics TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS email_scope_cleanup AFTER DELETE ON email_settings BEGIN DELETE FROM email_notification_scope WHERE user_id=OLD.user_id; END;
        CREATE TABLE IF NOT EXISTS email_tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,purpose TEXT NOT NULL,version INTEGER NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS email_requests(user_id TEXT NOT NULL,purpose TEXT NOT NULL,issued INTEGER NOT NULL,PRIMARY KEY(user_id,purpose));
        CREATE TABLE IF NOT EXISTS email_outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,expires INTEGER NOT NULL,notification_after INTEGER NOT NULL DEFAULT 0,notification_before INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS ix_email_outbox_pending ON email_outbox(status,next_attempt);
        CREATE TRIGGER IF NOT EXISTS email_account_closed AFTER UPDATE OF closed_at ON users WHEN NEW.closed_at IS NOT NULL BEGIN
          DELETE FROM email_settings WHERE user_id=NEW.id; DELETE FROM email_tokens WHERE user_id=NEW.id;
          DELETE FROM email_requests WHERE user_id=NEW.id; DELETE FROM email_outbox WHERE user_id=NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS email_identity_changed AFTER UPDATE OF email ON users WHEN OLD.email<>NEW.email BEGIN
          DELETE FROM email_settings WHERE user_id=NEW.id; DELETE FROM email_tokens WHERE user_id=NEW.id;
          DELETE FROM email_outbox WHERE user_id=NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS email_password_changed AFTER UPDATE OF session_version ON users WHEN OLD.session_version<>NEW.session_version BEGIN
          DELETE FROM email_tokens WHERE user_id=NEW.id;
          DELETE FROM email_outbox WHERE user_id=NEW.id AND kind IN ('verify','reset');
        END;
        """);
    }
    public EmailSettingsDto Status(string id, string? locale = null)
    {
        using var c = Open(); using var q = Cmd(c, null, """
        SELECT u.email,COALESCE(s.verified,0),COALESCE(s.notifications,0),
        (SELECT status FROM email_outbox WHERE user_id=u.id AND kind='verify' ORDER BY next_attempt DESC LIMIT 1),COALESCE(u.locale,'zh-CN')
        FROM users u LEFT JOIN email_settings s ON s.user_id=u.id AND s.email=u.email WHERE u.id=$id AND u.is_active=1 AND u.closed_at IS NULL
        """, ("$id", id)); using var r = q.ExecuteReader();
        if(!r.Read()) return new(settings.Ready, "", false, false, null, []);
        var email=r.GetString(0);var verified=r.GetBoolean(1);var enabled=r.GetBoolean(2);var delivery=r.IsDBNull(3)?null:r.GetString(3);var en=(locale??r.GetString(4))=="en-US";r.Close();
        var selected=ReadTopics(c,null,id);
        string[] names=en?["Project completed","Changes requested","Final delivery","New replies","Other progress updates","Other notifications"]:["项目完成","退回修改","成品交付","新回复","其他进度更新","其他通知"];
        return new(settings.Ready,email,verified,enabled,delivery,TopicIds.Select((key,index)=>new EmailTopicOption(key,names[index],selected.Contains(key))).ToArray());
    }
    internal static readonly string[] TopicIds=["completed","returned","delivery","replies","progress","other"];
    private static string[] ReadTopics(SqliteConnection c,SqliteTransaction? tx,string id){
        using var q=Cmd(c,tx,"SELECT topics FROM email_notification_scope WHERE user_id=$id",("$id",id));
        return q.ExecuteScalar() is string json?System.Text.Json.JsonSerializer.Deserialize(json,Lifewood.PlatformApi.Serialization.AppJsonContext.Default.StringArray)??[]:TopicIds;
    }
    internal static readonly string[] QueueStates = ["pending", "retrying", "sent", "failed", "expired", "cancelled", "paused"];
    internal static readonly string[] QueueKinds = ["verify", "reset", "notice", "security"];
    public MailQueuePage QueueStatus(string? status, string? kind, int page)
    {
        const int size = 25;
        var now = Now;
        using var c = Open(); using var tx = c.BeginTransaction(deferred: true);
        // A read-only projection: disabled sending and expired links must not look ready to send.
        const string source = """
        WITH queue AS (
          SELECT m.id,m.email,m.kind,m.attempts,m.next_attempt,m.expires,
          CASE WHEN m.status='pending' AND m.expires<=$now THEN 'expired'
               WHEN m.status='pending' AND ($ready=0 OR u.id IS NULL OR u.is_active=0 OR u.closed_at IS NOT NULL
                 OR (m.kind='notice' AND NOT EXISTS(SELECT 1 FROM email_settings s WHERE s.user_id=u.id AND s.email=u.email AND s.verified=1 AND s.notifications=1))) THEN 'paused'
               WHEN m.status='pending' AND m.attempts>0 THEN 'retrying' ELSE m.status END AS state
          FROM email_outbox m LEFT JOIN users u ON u.id=m.user_id AND u.email=m.email
          WHERE m.expires >= $old
        )
        """;
        (string, object?)[] parameters = [("$now", now), ("$ready", settings.Ready ? 1 : 0), ("$old", now - 7 * 86400), ("$status", status ?? ""), ("$kind", kind ?? "")];
        var totals = new Dictionary<string, long>();
        using (var q = Cmd(c, tx, source + "SELECT state,COUNT(*) FROM queue GROUP BY state", parameters))
        using (var r = q.ExecuteReader()) while (r.Read()) totals[r.GetString(0)] = r.GetInt64(1);
        const string filter = " WHERE ($status='' OR state=$status) AND ($kind='' OR kind=$kind)";
        long total;
        using (var q = Cmd(c, tx, source + "SELECT COUNT(*) FROM queue" + filter, parameters)) total = Convert.ToInt64(q.ExecuteScalar());
        page = (int)Math.Clamp(page, 1, Math.Max(1, (total + size - 1) / size));
        var items = new List<MailQueueItem>();
        using (var q = Cmd(c, tx, source + "SELECT id,email,kind,state,attempts,next_attempt,expires FROM queue" + filter + " ORDER BY expires DESC,id DESC LIMIT $size OFFSET $offset", [.. parameters, ("$size", size), ("$offset", (page - 1L) * size)]))
        using (var r = q.ExecuteReader()) while (r.Read()) {
            var email = r.GetString(1); var at = email.LastIndexOf('@');
            var masked = at > 0 ? email[..1] + "***" + email[at..] : "***";
            var state = r.GetString(3);
            items.Add(new(r.GetString(0), masked, r.GetString(2), state, r.GetInt32(4), state is "pending" or "retrying" ? r.GetInt64(5) : null, r.GetInt64(6)));
        }
        tx.Commit();
        return new(settings.Ready, now, QueueStates.Select(state => new MailQueueCount(state, totals.GetValueOrDefault(state))).ToArray(), QueueKinds, items, total, page, size, settings.ConfigurationChecks);
    }
    public bool SavePreferences(string id, bool enabled, string[]? topics=null)
    {
        if(topics is not null && (topics.Length>TopicIds.Length || topics.Any(topic=>!TopicIds.Contains(topic)) || topics.Distinct().Count()!=topics.Length)) return false;
        using var c = Open(); using var tx = c.BeginTransaction(deferred: false);
        using var q = Cmd(c, tx, """
        UPDATE email_settings SET notifications=$enabled,cursor=CASE WHEN notifications=0 AND $enabled=1 THEN COALESCE((SELECT MAX(id) FROM notifications WHERE user_id=$id),0) ELSE cursor END
        WHERE user_id=$id AND ($enabled=0 OR (verified=1 AND $ready=1)) AND EXISTS(SELECT 1 FROM users u WHERE u.id=$id AND u.email=email_settings.email AND u.is_active=1 AND u.closed_at IS NULL)
        """, ("$id", id), ("$enabled", enabled ? 1 : 0), ("$ready", settings.Ready ? 1 : 0));
        if (q.ExecuteNonQuery() != 1) return false;
        if(topics is not null) Exec(c,tx,"INSERT INTO email_notification_scope(user_id,topics) VALUES($id,$topics) ON CONFLICT(user_id) DO UPDATE SET topics=excluded.topics",("$id",id),("$topics",System.Text.Json.JsonSerializer.Serialize(topics,Lifewood.PlatformApi.Serialization.AppJsonContext.Default.StringArray)));
        if (!enabled) Exec(c, tx, "DELETE FROM email_outbox WHERE user_id=$id AND kind='notice' AND status='pending'", ("$id", id));
        tx.Commit(); return true;
    }
    public bool Request(string purpose, string identity)
    {
        if (!settings.Ready || purpose is not ("verify" or "reset")) return false;
        using var c = Open(); using var tx = c.BeginTransaction(deferred: false);
        using var q = Cmd(c, tx, "SELECT u.id,u.email,COALESCE(u.locale,'zh-CN'),u.session_version FROM users u WHERE " + (purpose == "verify" ? "u.id=$identity" : "u.normalized_email=$identity AND EXISTS(SELECT 1 FROM email_settings s WHERE s.user_id=u.id AND s.email=u.email AND s.verified=1)") + " AND u.is_active=1 AND u.closed_at IS NULL", ("$identity", purpose == "verify" ? identity : identity.Trim().ToUpperInvariant()));
        using var r = q.ExecuteReader(); if (!r.Read()) return false;
        var id = r.GetString(0); var email = r.GetString(1); var en = r.GetString(2) == "en-US"; var version = r.GetInt32(3); r.Close();
        using var previous = Cmd(c, tx, "SELECT issued FROM email_requests WHERE user_id=$id AND purpose=$purpose", ("$id", id), ("$purpose", purpose));
        if (previous.ExecuteScalar() is long issued && Now - issued < 60) return false;
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var hash = Hash(token);
        Exec(c, tx, "DELETE FROM email_tokens WHERE user_id=$id AND purpose=$purpose", ("$id", id), ("$purpose", purpose));
        Exec(c, tx, "DELETE FROM email_outbox WHERE user_id=$id AND kind=$purpose", ("$id", id), ("$purpose", purpose));
        Exec(c, tx, "INSERT INTO email_tokens VALUES($hash,$id,$email,$purpose,$version,$expires)", ("$hash", hash), ("$id", id), ("$email", email), ("$purpose", purpose), ("$version", version), ("$expires", Now + 600));
        Exec(c, tx, "INSERT INTO email_requests VALUES($id,$purpose,$now) ON CONFLICT(user_id,purpose) DO UPDATE SET issued=excluded.issued", ("$id", id), ("$purpose", purpose), ("$now", Now));
        var url = $"{settings.PublicUrl}/{(en ? "en-US" : "zh-CN")}/email-action#purpose={purpose}&token={token}";
        Queue(c, tx, id, email, Templates.Render(purpose, en ? "en-US" : "zh-CN", url), Now + 600);
        tx.Commit(); return true;
    }
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public bool Consume(string purpose, string token, string? password = null)
    {
        if (token is null || token.Length != 64 || !token.All(Uri.IsHexDigit) || purpose is not ("verify" or "reset")) return false;
        if (purpose == "reset" && (password is null || password.Length is < 8 or > 128)) return false;
        using var c = Open(); using var tx = c.BeginTransaction(deferred: false);
        using var q = Cmd(c, tx, """
        SELECT u.id,u.email,COALESCE(u.locale,'zh-CN') FROM email_tokens t JOIN users u ON u.id=t.user_id AND u.email=t.email AND u.session_version=t.version
        WHERE t.hash=$hash AND t.purpose=$purpose AND t.expires>$now AND u.is_active=1 AND u.closed_at IS NULL
        """, ("$hash", Hash(token)), ("$purpose", purpose), ("$now", Now));
        using var r = q.ExecuteReader(); if (!r.Read()) return false;
        var id = r.GetString(0); var email = r.GetString(1); var en = r.GetString(2) == "en-US"; r.Close();
        if (purpose == "verify") Exec(c, tx, "INSERT INTO email_settings(user_id,email,verified) VALUES($id,$email,1) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified=1", ("$id", id), ("$email", email));
        else
        {
            users.ApplyEmailPasswordReset(c, tx, id, password!);
            Queue(c, tx, id, email, Templates.Render("security", en ? "en-US" : "zh-CN"), Now + 86400);
        }
        Exec(c, tx, "DELETE FROM email_tokens WHERE hash=$hash", ("$hash", Hash(token)));
        Exec(c, tx, "DELETE FROM email_outbox WHERE user_id=$id AND kind=$kind", ("$id", id), ("$kind", purpose));
        tx.Commit(); return true;
    }
    private void Queue(SqliteConnection c, SqliteTransaction tx, string id, string email, MailTemplate template, long expires, long after = 0, long before = 0)
    { Exec(c, tx, "INSERT INTO email_outbox(id,user_id,email,kind,subject,body,next_attempt,expires,notification_after,notification_before) VALUES($key,$id,$email,$kind,$subject,$body,$now,$expires,$after,$before)", ("$key", Guid.NewGuid().ToString("N")), ("$id", id), ("$email", email), ("$kind", template.Kind), ("$subject", template.Subject), ("$body", protector.Protect(template.Body.Encode())), ("$now", Now), ("$expires", expires), ("$after", after), ("$before", before)); }
    public void QueueNotifications()
    {
        using var c = Open();
        using var query = Cmd(c, null, "SELECT s.user_id FROM email_settings s JOIN users u ON u.id=s.user_id AND u.email=s.email WHERE s.verified=1 AND s.notifications=1 AND u.is_active=1 AND u.closed_at IS NULL AND EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=u.id AND n.id>s.cursor) LIMIT 50");
        var ids = new List<string>(); using (var r = query.ExecuteReader()) while (r.Read()) ids.Add(r.GetString(0));
        foreach (var id in ids)
        {
            // Snapshot before entering the write transaction: List owns a separate connection.
            using var maximum = Cmd(c, null, "SELECT COALESCE(MAX(id),0) FROM notifications WHERE user_id=$id", ("$id", id));
            var watermark = Convert.ToInt64(maximum.ExecuteScalar());
            using var tx = c.BeginTransaction(deferred: false);
            using var get = Cmd(c, tx, "SELECT u.email,COALESCE(u.locale,'zh-CN'),s.cursor FROM users u JOIN email_settings s ON s.user_id=u.id AND s.email=u.email WHERE u.id=$id AND u.is_active=1 AND u.closed_at IS NULL AND s.notifications=1 AND s.verified=1", ("$id", id));
            using var r = get.ExecuteReader(); if (!r.Read()) continue;
            var email = r.GetString(0); var locale = r.GetString(1); var cursor = r.GetInt64(2); r.Close();
            if (!Templates.Render("notice",locale,$"{settings.PublicUrl}/{locale}/notifications").Enabled) {
                Exec(c,tx,"UPDATE email_settings SET cursor=MAX(cursor,$watermark) WHERE user_id=$id",("$id",id),("$watermark",watermark));
                tx.Commit(); continue;
            }
            // Reads use the notification repository's current permission checks. Mail contains no project/user content.
            if (notifications.HasEmailCandidate(id,cursor,watermark,ReadTopics(c,tx,id))) {
                using var pending = Cmd(c, tx, "UPDATE email_outbox SET notification_before=$before WHERE user_id=$id AND kind='notice' AND status='pending' AND expires>$now", ("$before", watermark), ("$id", id), ("$now", Now));
                if (pending.ExecuteNonQuery() == 0) Queue(c, tx, id, email, Templates.Render("notice", locale, $"{settings.PublicUrl}/{(locale == "en-US" ? "en-US" : "zh-CN")}/notifications"), Now + 86400, cursor, watermark);
            }
            Exec(c, tx, "UPDATE email_settings SET cursor=MAX(cursor,$watermark) WHERE user_id=$id", ("$id", id), ("$watermark", watermark));
            tx.Commit();
        }
    }
    public async Task DeliverOne(IPlatformMailer mailer, CancellationToken cancellation)
    {
        await deliveryLock.WaitAsync(cancellation);
        try { await DeliverLocked(mailer, cancellation); }
        finally { deliveryLock.Release(); }
    }
    private async Task DeliverLocked(IPlatformMailer mailer, CancellationToken cancellation)
    {
        using var c = Open();
        var now = Now;
        Exec(c, null, """
        DELETE FROM email_tokens WHERE expires<=$now;
        UPDATE email_outbox SET status='expired',body='' WHERE status='pending' AND expires<=$now;
        UPDATE email_outbox SET body='' WHERE status<>'pending' AND body<>'';
        DELETE FROM email_outbox WHERE expires<$old;
        """, ("$now", now), ("$old", now - 7 * 86400));
        if (!settings.Ready) return;
        using var q = Cmd(c, null, """
        SELECT m.id,m.email,m.subject,m.body,m.user_id,m.kind,m.notification_after,m.notification_before FROM email_outbox m JOIN users u ON u.id=m.user_id AND u.email=m.email
        WHERE m.status='pending' AND m.next_attempt<=$now AND m.expires>$now AND u.is_active=1 AND u.closed_at IS NULL
        AND (m.kind<>'notice' OR EXISTS(SELECT 1 FROM email_settings s WHERE s.user_id=u.id AND s.email=u.email AND s.verified=1 AND s.notifications=1)) ORDER BY CASE WHEN m.kind IN ('verify','reset') THEN 0 ELSE 1 END,m.next_attempt LIMIT 1
        """, ("$now", Now));
        using var r = q.ExecuteReader(); if (!r.Read()) return;
        var id = r.GetString(0); var address = r.GetString(1); var subject = r.GetString(2); var encrypted = r.GetString(3);
        var userId = r.GetString(4); var kind = r.GetString(5); var after = r.GetInt64(6); var before = r.GetInt64(7); r.Close();
        using var languageQuery=Cmd(c,null,"SELECT COALESCE(locale,'zh-CN') FROM users WHERE id=$id",("$id",userId));
        if (kind=="notice" && !Templates.Render("notice",(string)languageQuery.ExecuteScalar()!,$"{settings.PublicUrl}/notifications").Enabled) {
            Exec(c,null,"UPDATE email_outbox SET status='cancelled',body='' WHERE id=$id",("$id",id)); return;
        }
        if (kind == "notice" && !notifications.HasEmailCandidate(userId,after,before,ReadTopics(c,null,userId))) {
            Exec(c, null, "UPDATE email_outbox SET status='cancelled',body='' WHERE id=$id", ("$id", id));
            return;
        }
        try { await mailer.SendContent(address, subject, MailBody.Decode(protector.Unprotect(encrypted)), cancellation); Exec(c, null, "UPDATE email_outbox SET status='sent',body='' WHERE id=$id", ("$id", id)); }
        catch (MailRateLimitedException) { /* Keep eligible messages queued; the next worker tick rechecks current limits. */ }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch { Exec(c, null, "UPDATE email_outbox SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,body=CASE WHEN attempts>=4 THEN '' ELSE body END,next_attempt=$next WHERE id=$id", ("$next", Now + 60), ("$id", id)); }
    }
}
