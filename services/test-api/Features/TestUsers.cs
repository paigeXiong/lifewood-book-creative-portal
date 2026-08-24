using Lifewood.TestApi.Contracts;

namespace Lifewood.TestApi.Features;

internal static class TestUsers
{
    private static readonly CurrentUserDto[] Users =
    [
        new(
            "admin-1", "lin.qi", "林琦", null, "lin.qi@example.test",
            new OrganizationDto("lifewood-cn", "Lifewood China"),
            ["administrator"], ["tasks.read", "tasks.write", "tasks.submit"], "zh-CN", "Asia/Shanghai"),
        new(
            "admin-2", "maya.chen", "Maya Chen", null, "maya.chen@example.test",
            new OrganizationDto("lifewood-global", "Lifewood Global"),
            ["operator"], ["tasks.read", "tasks.write"], "en-US", "Asia/Singapore"),
        new(
            "viewer-1", "casey.read", "Casey Read", null, "casey.read@example.test",
            new OrganizationDto("lifewood-global", "Lifewood Global"),
            ["viewer"], ["tasks.read"], "en-US", "Asia/Singapore")
    ];

    public static CurrentUserDto[] All() => Users;
    public static CurrentUserDto? Find(string id) => Users.FirstOrDefault(user => user.Id == id);
}
