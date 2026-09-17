using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class UserRepository
{
    public MyOrganizationPage ReadMyOrganization(string actorId, string? search, int page, string? locale)
    {
        const int size = 12;
        var en = locale == "en-US";
        var labels = en
            ? new MyOrganizationLabels("Members", "Search member names", "No matching members", "No organization assigned", "Active", "Inactive", "You")
            : new MyOrganizationLabels("组织成员", "搜索成员姓名", "没有符合条件的成员", "尚未分配组织", "启用", "停用", "我");
        using var db = Open();
        using var tx = db.BeginTransaction();
        using var organization = db.CreateCommand();
        organization.Transaction = tx;
        organization.CommandText = """
            SELECT o.id,o.name,o.is_active FROM users a JOIN organizations o ON o.id=a.organization_id
            WHERE a.id=$actor AND a.is_active=1 AND a.closed_at IS NULL
            """;
        organization.Parameters.AddWithValue("$actor", actorId);
        string orgId, name; bool active;
        using (var reader = organization.ExecuteReader())
        {
            if (!reader.Read()) return new(null, [], 1, size, 0, labels);
            orgId = reader.GetString(0); name = reader.GetString(1); active = reader.GetInt32(2) == 1;
        }
        // Treat search as literal text, and never accept an organization ID from the caller.
        var term = (search ?? "").Trim();
        var pattern = "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
        using var count = db.CreateCommand();
        count.Transaction = tx;
        count.CommandText = """
            SELECT COUNT(*),COALESCE(SUM(CASE WHEN display_name LIKE $search ESCAPE '\' THEN 1 ELSE 0 END),0)
            FROM users WHERE organization_id=$org AND closed_at IS NULL
            """;
        count.Parameters.AddWithValue("$org", orgId); count.Parameters.AddWithValue("$search", pattern);
        int all, total;
        using (var reader = count.ExecuteReader()) { reader.Read(); all = reader.GetInt32(0); total = reader.GetInt32(1); }
        page = Math.Clamp(page, 1, Math.Max(1, (total + size - 1) / size));
        using var members = db.CreateCommand();
        members.Transaction = tx;
        members.CommandText = """
            SELECT id,display_name,role,is_active FROM users
            WHERE organization_id=$org AND closed_at IS NULL AND display_name LIKE $search ESCAPE '\'
            ORDER BY display_name COLLATE NOCASE,id LIMIT $size OFFSET $offset
            """;
        members.Parameters.AddWithValue("$org", orgId); members.Parameters.AddWithValue("$search", pattern);
        members.Parameters.AddWithValue("$size", size); members.Parameters.AddWithValue("$offset", (page - 1) * size);
        var items = new List<MyOrganizationMember>();
        using (var reader = members.ExecuteReader())
            while (reader.Read())
            {
                var id = reader.GetString(0);
                var role = OrganizationRoleLabel(reader.GetString(2), en);
                items.Add(new(id, reader.GetString(1), role, reader.GetInt32(3) == 1, id == actorId,
                    $"/api/me/organization/members/{Uri.EscapeDataString(id)}/avatar"));
            }
        return new(new(name, active, all), items.ToArray(), page, size, total, labels);
    }

    public string? FindOrganizationMemberName(string actorId, string memberId)
    {
        using var db = Open(); using var command = db.CreateCommand();
        command.CommandText = """
            SELECT m.display_name FROM users a JOIN users m ON m.organization_id=a.organization_id
            JOIN organizations o ON o.id=a.organization_id
            WHERE a.id=$actor AND a.is_active=1 AND a.closed_at IS NULL AND m.id=$member AND m.closed_at IS NULL
            """;
        command.Parameters.AddWithValue("$actor", actorId); command.Parameters.AddWithValue("$member", memberId);
        return command.ExecuteScalar() as string;
    }

    public OrganizationMemberProfile? ReadOrganizationMember(string actorId, string memberId, string? locale)
    {
        using var db = Open(); using var command = db.CreateCommand();
        command.CommandText = """
            SELECT m.id,m.display_name,m.role,o.name FROM users a
            JOIN users m ON m.organization_id=a.organization_id JOIN organizations o ON o.id=a.organization_id
            WHERE a.id=$actor AND a.is_active=1 AND a.closed_at IS NULL AND m.id=$member AND m.closed_at IS NULL
            """;
        command.Parameters.AddWithValue("$actor", actorId); command.Parameters.AddWithValue("$member", memberId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        var en = locale == "en-US";
        return new(reader.GetString(0), reader.GetString(1), OrganizationRoleLabel(reader.GetString(2), en), reader.GetString(3),
            $"/api/me/organization/members/{Uri.EscapeDataString(reader.GetString(0))}/avatar",
            en ? new("Name", "Organization", "Role") : new("姓名", "所属组织", "角色"));
    }

    private static string OrganizationRoleLabel(string role, bool en) => (role, en) switch
    {
        ("owner", true) => "Platform owner", ("owner", false) => "平台负责人",
        ("admin", true) => "Administrator", ("admin", false) => "管理员",
        ("operator", true) => "Operator", ("operator", false) => "运营人员",
        ("customer", true) => "Customer member", ("customer", false) => "客户成员",
        (_, true) => "Member", _ => "成员"
    };
}
