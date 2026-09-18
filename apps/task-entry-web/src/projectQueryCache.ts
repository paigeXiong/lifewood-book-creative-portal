import type { QueryClient } from "@tanstack/react-query";

const userScopedProjectKeys = new Set(["revision", "project", "projects", "project-stats", "customer-dashboard", "my-organization", "organization-member", "organization-member-activity", "project-deliveries", "project-resume", "saved-views", "login-devices"]);

export function clearUserProjectQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => userScopedProjectKeys.has(String(query.queryKey[0] ?? "")),
  });
}
