import type { QueryClient } from "@tanstack/react-query";

const userScopedProjectKeys = new Set(["project", "projects", "project-stats", "customer-dashboard", "project-deliveries", "project-resume", "saved-views", "login-devices"]);

export function clearUserProjectQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => userScopedProjectKeys.has(String(query.queryKey[0] ?? "")),
  });
}
