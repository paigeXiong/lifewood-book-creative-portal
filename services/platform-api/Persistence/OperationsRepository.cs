using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class OperationsRepository(string connectionString)
{
    private const string Visible = "(p.status='submitted' OR EXISTS(SELECT 1 FROM revision_rounds r WHERE r.project_id=p.id))";
    private const string Scope = "EXISTS(SELECT 1 FROM users staff WHERE staff.id=$actor AND staff.is_active=1 AND (staff.role IN ('owner','admin') OR (staff.role='operator' AND p.assignee_user_id=staff.id)))";
    private const string Active = "p.workflow_status NOT IN ('completed','closed')";
    private static readonly (string Id, string Zh, string En, string Filter)[] Queues = [
        ("active", "进行中", "Active", Active),
        ("new", "待跟进", "To follow up", Active + " AND p.status='submitted' AND p.workflow_status='new'"),
        ("waiting_customer", "等待客户", "Waiting for customer", Active + " AND p.workflow_status='awaiting_customer'"),
        ("due_soon", "24 小时内到期", "Due within 24 hours", Active + " AND julianday(p.followup_due_at)>julianday($now) AND julianday(p.followup_due_at)<=julianday($now,'+1 day')"),
        ("overdue", "已逾期", "Overdue", Active + " AND julianday(p.followup_due_at)<=julianday($now)"),
        ("recent_delivery", "近 7 天交付", "Delivered in 7 days", "EXISTS(SELECT 1 FROM project_deliveries d WHERE d.project_id=p.id AND d.revoked_at IS NULL AND julianday(d.published_at)>=julianday($now,'-7 days'))"),
        ("unassigned", "待分配", "Unassigned", Active + " AND p.assignee_user_id IS NULL")
    ];

    public WorkbenchDto Workbench(string actorId, string locale, string? queue, string? search, bool mine, int page, int pageSize, DateTimeOffset? time = null)
    {
        var now = time ?? DateTimeOffset.UtcNow;
        using var connection = Open();
        using var tx = connection.BeginTransaction(deferred: true);
        var where = $"{Visible} AND {Scope} AND ($mine=0 OR p.assignee_user_id=$actor) AND ($search='' OR instr(lower(p.project_json),lower($search))>0 OR instr(lower(p.book_json),lower($search))>0 OR instr(lower(u.display_name),lower($search))>0 OR instr(lower(u.email),lower($search))>0 OR instr(lower(COALESCE(p.task_number,'')),lower($search))>0)";
        var from = " FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN users a ON a.id=p.assignee_user_id ";
        using var counts = Command(connection, tx, "SELECT " + string.Join(",", Queues.Select(q => $"COALESCE(SUM(CASE WHEN {q.Filter} THEN 1 ELSE 0 END),0)")) + from + " WHERE " + where, actorId, now, mine, search);
        var labels = new List<WorkbenchQueueDto>();
        using (var reader = counts.ExecuteReader())
        {
            reader.Read();
            for (var i=0;i<Queues.Length;i++) labels.Add(new(Queues[i].Id, locale=="en-US"?Queues[i].En:Queues[i].Zh, reader.GetInt32(i)));
        }
        var selected = Queues.FirstOrDefault(q => q.Id == queue);
        if (selected.Id is null) selected = Queues[0];
        var total = labels.Single(q => q.Id == selected.Id).Count;
        using var rows = Command(connection, tx, """
            SELECT p.id,p.task_number,COALESCE(json_extract(p.project_json,'$.projectName'),''),COALESCE(json_extract(p.book_json,'$.title'),''),
                u.display_name,a.display_name,p.workflow_status,p.priority,p.status,p.followup_due_at,COALESCE(p.workflow_updated_at,p.updated_at)
            """ + from + " WHERE " + where + " AND " + selected.Filter + " ORDER BY CASE WHEN p.followup_due_at IS NULL THEN 1 ELSE 0 END,julianday(p.followup_due_at),COALESCE(p.workflow_updated_at,p.updated_at) DESC,p.id LIMIT $size OFFSET $offset", actorId, now, mine, search);
        rows.Parameters.AddWithValue("$size", pageSize); rows.Parameters.AddWithValue("$offset", (long)(page-1)*pageSize);
        var items = new List<WorkbenchProjectDto>();
        using (var reader = rows.ExecuteReader()) while (reader.Read()) items.Add(new(reader.GetString(0),reader.IsDBNull(1)?null:reader.GetString(1),reader.GetString(2),reader.GetString(3),reader.GetString(4),reader.IsDBNull(5)?null:reader.GetString(5),reader.GetString(6),reader.GetString(7),reader.GetString(8),reader.IsDBNull(9)?null:DateTimeOffset.Parse(reader.GetString(9)),DateTimeOffset.Parse(reader.GetString(10))));
        tx.Commit();
        return new([..labels],[..items],page,pageSize,total,now);
    }

    public FollowupDto? GetFollowup(string projectId, string actorId)
    {
        using var connection=Open();
        using var command=connection.CreateCommand();
        command.CommandText=$"SELECT p.followup_due_at,p.followup_version FROM projects p WHERE p.id=$id AND {Visible} AND {Scope}";
        command.Parameters.AddWithValue("$id",projectId);command.Parameters.AddWithValue("$actor",actorId);
        using var reader=command.ExecuteReader();
        return reader.Read()?new(reader.IsDBNull(0)?null:DateTimeOffset.Parse(reader.GetString(0)),reader.GetInt32(1)):null;
    }

    public AdminWriteResult SetFollowup(string projectId, string actorId, UpdateFollowupRequest request)
    {
        if(request.ExpectedVersion<0 || request.DueAt?.Year is <2000 or >2100)return new(AdminWriteOutcome.Invalid,"dueAt");
        using var connection=Open(); using var tx=connection.BeginTransaction(deferred:false);
        if(!ProjectAccess.Allows(connection,tx,projectId,actorId))return new(AdminWriteOutcome.NotFound);
        using var read=connection.CreateCommand();read.Transaction=tx;
        read.CommandText=$"SELECT p.followup_due_at,p.followup_version,p.workflow_status FROM projects p WHERE p.id=$id AND {Visible}";read.Parameters.AddWithValue("$id",projectId);
        using var reader=read.ExecuteReader();if(!reader.Read())return new(AdminWriteOutcome.NotFound);
        var current=reader.IsDBNull(0)?null:reader.GetString(0);var version=reader.GetInt32(1);var workflow=reader.GetString(2);reader.Close();
        if(version!=request.ExpectedVersion)return new(AdminWriteOutcome.Conflict);
        if(request.DueAt is not null && workflow is "completed" or "closed")return new(AdminWriteOutcome.Invalid,"dueAt");
        var value=request.DueAt?.ToUniversalTime().ToString("O");
        if(current==value){tx.Commit();return new(AdminWriteOutcome.Saved);}
        using var update=connection.CreateCommand();update.Transaction=tx;
        update.CommandText="UPDATE projects SET followup_due_at=$due,followup_version=followup_version+1 WHERE id=$id";
        update.Parameters.AddWithValue("$due",(object?)value??DBNull.Value);update.Parameters.AddWithValue("$id",projectId);update.ExecuteNonQuery();
        tx.Commit();return new(AdminWriteOutcome.Saved);
    }

    // One durable event per deadline version, assignee and threshold, including across restarts.
    public void CreateDueReminders(DateTimeOffset now)
    {
        using var connection=Open();using var tx=connection.BeginTransaction(deferred:false);
        using var rows=connection.CreateCommand();rows.Transaction=tx;
        rows.CommandText=$"SELECT p.id,p.followup_version,COALESCE(p.assignee_user_id,''),CASE WHEN julianday(p.followup_due_at)<=julianday($now) THEN 'followup_overdue' ELSE 'followup_due' END FROM projects p WHERE {Visible} AND {Active} AND p.followup_due_at IS NOT NULL AND julianday(p.followup_due_at)<=julianday($now,'+1 day')";
        rows.Parameters.AddWithValue("$now",now.ToUniversalTime().ToString("O"));
        var pending=new List<(string Project,string Target,string Kind)>();
        using(var reader=rows.ExecuteReader())while(reader.Read())pending.Add((reader.GetString(0),reader.GetInt32(1)+":"+reader.GetString(2),reader.GetString(3)));
        foreach(var item in pending)
        {
            using var mark=connection.CreateCommand();mark.Transaction=tx;
            mark.CommandText="INSERT OR IGNORE INTO followup_reminders(project_id,target,kind) VALUES($id,$target,$kind)";
            mark.Parameters.AddWithValue("$id",item.Project);mark.Parameters.AddWithValue("$target",item.Target);mark.Parameters.AddWithValue("$kind",item.Kind);
            if(mark.ExecuteNonQuery()==1)NotificationRepository.Capture(connection,tx,"followup:"+item.Project+":"+item.Target+":"+item.Kind,item.Kind,item.Project,"",item.Target);
        }
        tx.Commit();
    }
    private static SqliteCommand Command(SqliteConnection c,SqliteTransaction tx,string sql,string actor,DateTimeOffset now,bool mine,string? search)
    {
        var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;q.Parameters.AddWithValue("$actor",actor);q.Parameters.AddWithValue("$now",now.ToUniversalTime().ToString("O"));q.Parameters.AddWithValue("$mine",mine?1:0);q.Parameters.AddWithValue("$search",search?.Trim()??"");return q;
    }
    private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();using var q=c.CreateCommand();q.CommandText="PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON";q.ExecuteNonQuery();return c;}
}
