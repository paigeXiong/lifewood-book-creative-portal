using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;

namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class UserRepository
{
    public OrganizationMemberActivity? ReadOrganizationMemberActivity(string actorId, string memberId, string? locale, string? search, int page)
    {
        const int size = 10;
        using var db = Open(); using var tx = db.BeginTransaction(deferred: true);
        using (var access = db.CreateCommand())
        {
            access.Transaction = tx;
            access.CommandText = """
                SELECT 1 FROM users a JOIN users m ON m.organization_id=a.organization_id JOIN organizations o ON o.id=a.organization_id
                WHERE a.id=$actor AND a.is_active=1 AND a.closed_at IS NULL AND m.id=$member AND m.closed_at IS NULL
                """;
            access.Parameters.AddWithValue("$actor", actorId); access.Parameters.AddWithValue("$member", memberId);
            if (access.ExecuteScalar() is null) return null;
        }
        var presence = UserPresenceRepository.ReadPresence(db, tx, memberId, DateTimeOffset.UtcNow.ToUnixTimeSeconds())!;
        // Returned projects expose only their last submitted title, never the editable draft.
        const string source = """
            WITH shared AS (
                SELECT p.id,p.workflow_status,
                CASE WHEN p.status='submitted' THEN json_extract(p.book_json,'$.title')
                    ELSE (SELECT json_extract(r.before_snapshot,'$.book.title') FROM revision_rounds r WHERE r.project_id=p.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) END AS book_title,
                CASE WHEN p.status='submitted' THEN json_extract(p.project_json,'$.projectName')
                    ELSE (SELECT json_extract(r.before_snapshot,'$.project.projectName') FROM revision_rounds r WHERE r.project_id=p.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) END AS project_name,
                (SELECT occurred_at FROM customer_first_submissions f WHERE f.project_id=p.id) AS submitted_at
                FROM projects p WHERE p.owner_id=$member AND (p.status='submitted' OR EXISTS(SELECT 1 FROM revision_rounds r WHERE r.project_id=p.id))
            ), named AS (SELECT *,COALESCE(NULLIF(book_title,''),NULLIF(project_name,''),'') AS name FROM shared)
            """;
        var pattern = "%" + (search ?? "").Trim().Replace("!", "!!").Replace("%", "!%").Replace("_", "!_") + "%";
        Microsoft.Data.Sqlite.SqliteCommand Query(string sql)
        {
            var command = db.CreateCommand(); command.Transaction = tx; command.CommandText = source + sql;
            command.Parameters.AddWithValue("$member", memberId); command.Parameters.AddWithValue("$search", pattern); return command;
        }
        OrganizationMemberCounts counts;
        using (var command = Query("SELECT COUNT(*),COALESCE(SUM(workflow_status NOT IN ('completed','closed','awaiting_customer')),0),COALESCE(SUM(workflow_status='awaiting_customer'),0),COALESCE(SUM(workflow_status='completed'),0) FROM named"))
        { using var reader = command.ExecuteReader(); reader.Read(); counts = new(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3)); }
        int total;
        using (var command = Query("SELECT COUNT(*) FROM named WHERE name LIKE $search ESCAPE '!'")) total = Convert.ToInt32(command.ExecuteScalar());
        page = Math.Clamp(page, 1, Math.Max(1, (total + size - 1) / size));
        var en = locale == "en-US";
        var options = FormOptionCatalog.ForLocale(en ? "en-US" : "zh-CN").WorkflowStatuses;
        var items = new List<OrganizationMemberProject>();
        using (var command = Query("SELECT id,name,workflow_status,submitted_at FROM named WHERE name LIKE $search ESCAPE '!' ORDER BY submitted_at DESC,id LIMIT $size OFFSET $offset"))
        {
            command.Parameters.AddWithValue("$size", size); command.Parameters.AddWithValue("$offset", (page - 1) * size);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var status = reader.GetString(2);
                var label = status == "awaiting_customer" ? (en ? "Changes or response requested" : "待修改或回复") : options.FirstOrDefault(o => o.Id == status)?.Label ?? (en ? "Submitted" : "已提交");
                items.Add(new(reader.GetString(0), string.IsNullOrWhiteSpace(reader.GetString(1)) ? (en ? "Untitled request" : "未命名需求") : reader.GetString(1), label, status,
                    reader.IsDBNull(3) ? null : reader.GetString(3), actorId == memberId));
            }
        }
        var labels = en ? new Dictionary<string, string> {
            ["activity"]="Sign-in activity",["lastLogin"]="Last sign-in",["lastActive"]="Last active",["noRecord"]="No record",
            ["submitted"]="Submitted requests",["inProgress"]="In progress",["actionRequired"]="Needs a response",["completed"]="Completed",
            ["requests"]="Submitted requests",["search"]="Search submitted request names",["name"]="Request",["status"]="Status",["submittedAt"]="First submitted",
            ["empty"]="No matching submitted requests",["scope"]="Includes submitted requests and requests returned for changes. Drafts are excluded. Returned titles reflect the last submission. Details follow existing access permissions; completion means manually marked complete. Historical submission times may be unavailable.",
            ["presenceHelp"]="Presence is estimated from recent browser activity and may update with a delay. No sign-in or activity record is shown when it has not been captured."
        } : new Dictionary<string, string> {
            ["activity"]="登录概况",["lastLogin"]="最近登录",["lastActive"]="最近活跃",["noRecord"]="暂无记录",
            ["submitted"]="已提交需求",["inProgress"]="进行中",["actionRequired"]="待修改或回复",["completed"]="已完成",
            ["requests"]="提交记录",["search"]="搜索已提交需求名称",["name"]="需求",["status"]="状态",["submittedAt"]="首次提交",
            ["empty"]="暂无符合条件的提交记录",["scope"]="统计已提交和退回修改中的需求，不含未提交草稿。退回中的名称取上次提交记录；详情沿用原有访问权限，完成以人工标记为准。未采集的历史提交时间显示暂无记录。",
            ["presenceHelp"]="在线状态依据近期浏览器活动估算，可能存在更新延迟。未采集的登录、活跃时间显示暂无记录。"
        };
        var presenceLabel = (presence.Status, en) switch { ("online",true)=>"Online",("online",false)=>"在线",("away",true)=>"Away",("away",false)=>"离开",(_,true)=>"Offline",_=>"离线" };
        labels["calendarHelp"] = en ? "Daily totals use UTC+8. Shows the current and previous two months. Color reflects sign-ins plus 15-minute periods with genuine interaction, deduplicated across tabs and devices; this is not online duration. Days before collection are unknown; the first collection day and today are partial." : "按 UTC+8 统计，展示本月及前两个月。颜色依据登录次数和有实际交互的15分钟时段数量，同一时段多标签、多设备合并计数，不代表在线时长。采集前日期标为未采集；首个采集日和今天均为不完整日。";
        labels["calendar"] = en ? "Activity calendar" : "活跃日历";
        labels["uncollected"] = en ? "Not collected" : "未采集";
        labels["future"] = en ? "Future date" : "未来日期";
        labels["logins"] = en ? "Sign-ins" : "登录次数";
        labels["periods"] = en ? "Active periods" : "活跃时段";
        labels["less"] = en ? "Less" : "少";
        labels["more"] = en ? "More" : "多";
        labels["previousMonth"] = en ? "Previous month" : "上个月";
        labels["nextMonth"] = en ? "Next month" : "下个月";
        var calendar = UserPresenceRepository.ReadCalendar(db, tx, memberId, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        tx.Commit();
        return new(presence, presenceLabel, counts, items.ToArray(), total, page, size, labels, calendar);
    }
}
