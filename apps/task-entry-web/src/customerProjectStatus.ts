/** Keep customer terminology separate from administrative workflow labels. */
export function customerStatusLabel(id: string, serverLabel: string | undefined, returnedLabel: string): string {
  return id === "awaiting_customer" ? returnedLabel : serverLabel ?? id;
}

export function customerStatusId(project: { status: string; workflowStatus?: string }): string {
  return project.status === "draft" && project.workflowStatus !== "awaiting_customer"
    ? "draft"
    : project.workflowStatus || project.status;
}
