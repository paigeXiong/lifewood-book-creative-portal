using System.Text.Json;

namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class NotificationRepository
{
    // Use the same access and expiry checks as the inbox, without its 30-row UI limit.
    internal bool HasEmailCandidate(string user, long after, long before, string[] topics)
    {
        using var c=Open();
        using var q=Cmd(c,"SELECT EXISTS(SELECT 1"+Joins+" WHERE n.user_id=$user AND n.id>$after AND n.id<=$before AND n.read_at IS NULL AND n.archived=0 AND "+Access+" AND ("+State+")<>'expired' AND CASE e.kind WHEN 'completed' THEN 'completed' WHEN 'returned' THEN 'returned' WHEN 'delivery' THEN 'delivery' WHEN 'admin_reply' THEN 'replies' WHEN 'customer_reply' THEN 'replies' WHEN 'feedback_reply' THEN 'replies' WHEN 'workflow' THEN 'progress' ELSE 'other' END IN (SELECT value FROM json_each($topics)))",("$user",user),("$after",after),("$before",before),("$topics",JsonSerializer.Serialize(topics,Lifewood.PlatformApi.Serialization.AppJsonContext.Default.StringArray)));
        return Convert.ToInt32(q.ExecuteScalar())==1;
    }
}
