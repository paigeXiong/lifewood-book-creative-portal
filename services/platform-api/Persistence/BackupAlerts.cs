using System.Globalization;
using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class NotificationRepository
{
    internal static bool IsBackupKind(string kind) => kind is "backup_failed" or "backup_damaged" or "backup_stale";

    // Run under BackupGate's business lease. Alert state and recipient snapshots commit together.
    internal void CheckBackupAlerts(BackupPolicy policy, BackupRecord[] records, DateTimeOffset now)
    {
        using var c=Open();using var tx=c.BeginTransaction();
        using var monitor=Cmd(c,"SELECT since FROM backup_alerts WHERE kind='schedule'");monitor.Transaction=tx;
        var previous=monitor.ExecuteScalar() as string;
        var enabledSince=previous is null?now:DateTimeOffset.Parse(previous,CultureInfo.InvariantCulture);
        using(var save=Cmd(c,"INSERT INTO backup_alerts(kind,since) VALUES('schedule',$since) ON CONFLICT(kind) DO UPDATE SET since=excluded.since",
            ("$since",policy.Enabled?enabledSince.ToString("O"):null))){save.Transaction=tx;save.ExecuteNonQuery();}
        var success=records.Where(x=>x.Status=="completed").OrderByDescending(x=>x.CreatedAt).FirstOrDefault();
        var scheduled=records.Where(x=>x.Source=="scheduled" && x.Status is "completed" or "failed").OrderByDescending(x=>x.CreatedAt).FirstOrDefault();
        var failure=scheduled?.Status=="failed" && (success is null || success.CreatedAt<scheduled.CreatedAt)?scheduled.Id:null;
        using var knownDamage=Cmd(c,"SELECT fingerprint FROM backup_alerts WHERE kind='backup_damaged'");knownDamage.Transaction=tx;
        var damagedIds=((knownDamage.ExecuteScalar() as string)??"").Split(',',StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var damaged=string.Join(",",records.Where(x=>x.Status=="completed" && (x.VerificationStatus=="damaged" || damagedIds.Contains(x.Id) && x.VerificationStatus!="passed")).Select(x=>x.Id).Order());
        var baseline=success is not null && success.CreatedAt>enabledSince?success.CreatedAt:enabledSince;
        var stale=policy.Enabled && now-baseline>=TimeSpan.FromDays(policy.Frequency=="weekly"?14:2);
        var candidates=new Dictionary<string,string?>{{"backup_failed",failure},{"backup_damaged",damaged.Length==0?null:damaged},{"backup_stale",stale?"stale":null}};
        foreach(var (kind,fingerprint) in candidates)
        {
            using var enabled=Cmd(c,"SELECT COALESCE(json_extract(document,'$.enabled'),1) FROM notification_rules WHERE kind=$kind",("$kind",kind));enabled.Transaction=tx;
            var active=Convert.ToInt32(enabled.ExecuteScalar())==1?fingerprint:null;
            using var read=Cmd(c,"SELECT fingerprint,event_key FROM backup_alerts WHERE kind=$kind",("$kind",kind));read.Transaction=tx;
            string? prior=null,key=null;using(var rd=read.ExecuteReader()){if(rd.Read()){prior=rd.IsDBNull(0)?null:rd.GetString(0);key=rd.IsDBNull(1)?null:rd.GetString(1);}}
            if(active==prior)continue;
            if(active is not null){key="backup-alert:"+kind+":"+Guid.NewGuid().ToString("N");Capture(c,tx,key,kind,"","system");}
            using var state=Cmd(c,"INSERT INTO backup_alerts(kind,fingerprint,event_key) VALUES($kind,$fingerprint,$key) ON CONFLICT(kind) DO UPDATE SET fingerprint=excluded.fingerprint,event_key=excluded.event_key",("$kind",kind),("$fingerprint",active),("$key",key));state.Transaction=tx;state.ExecuteNonQuery();
        }
        tx.Commit();
    }
}
