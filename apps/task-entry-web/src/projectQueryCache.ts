import type { QueryClient } from "@tanstack/react-query";

const userScopedProjectKeys = new Set(["project", "projects", "project-stats", "project-deliveries"]);

export function clearUserProjectQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => userScopedProjectKeys.has(String(query.queryKey[0] ?? "")),
  });
}
