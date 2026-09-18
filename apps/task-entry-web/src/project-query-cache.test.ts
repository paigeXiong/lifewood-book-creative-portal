import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { clearUserProjectQueries } from "./projectQueryCache";

describe("user project query cache", () => {
  it("removes user-scoped project data while preserving shared configuration", () => {
    const client = new QueryClient();
    client.setQueryData(["projects", "zh-CN", "", "", 1], { items: [{ id: "private" }] });
    client.setQueryData(["project", "private"], { id: "private" });
    client.setQueryData(["project-stats"], { total: 1 });
    client.setQueryData(["project-deliveries", "private", "zh-CN"], [{ id: "delivery" }]);
    client.setQueryData(["form-options", "zh-CN"], { taskStatuses: [] });

    const privateKeys = [["revision", "private", "zh-CN"],["saved-views", "account-a", "tasks"], ["login-devices", "account-a", 1], ["project-resume", ["private"]], ["saved-views", "tasks"], ["login-devices", 1]];
    privateKeys.forEach(key => client.setQueryData(key, { private: true }));
    clearUserProjectQueries(client);
    privateKeys.forEach(key => expect(client.getQueryData(key)).toBeUndefined());

    expect(client.getQueryData(["projects", "zh-CN", "", "", 1])).toBeUndefined();
    expect(client.getQueryData(["project", "private"])).toBeUndefined();
    expect(client.getQueryData(["project-stats"])).toBeUndefined();
    expect(client.getQueryData(["project-deliveries", "private", "zh-CN"])).toBeUndefined();
    expect(client.getQueryData(["form-options", "zh-CN"])).toEqual({ taskStatuses: [] });
  });
});
