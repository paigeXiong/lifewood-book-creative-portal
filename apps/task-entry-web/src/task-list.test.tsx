import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { projectService } from "@lifewood/api-client";
import { i18n } from "@lifewood/i18n";
import type { SupportedLocale, TaskSummary } from "@lifewood/domain";
import { TaskListPage } from "./pages/TaskListPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(locale: SupportedLocale, query = "", total = 30, items: TaskSummary[] = [], withOrganization = true) {
  await i18n.changeLanguage(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["form-options", locale], { taskStatuses: [{ id: "draft", label: locale === "zh-CN" ? "草稿" : "Draft" }], workflowStatuses: [] });
  client.setQueryData(["current-user"], { id: "customer", displayName: "Customer", roles: ["customer"], permissions: ["tasks.write"], organization: withOrganization ? { id: "org", name: "Organization" } : null });
  client.setQueryData(["project-stats"], { total, drafts: total, active: 0, completed: 0, actionRequired: 0 });
  const list = vi.spyOn(projectService, "listProjects").mockImplementation(async params => ({ items, page: params.page ?? 1, pageSize: 10, total }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  function Page() {
    const location = useLocation(); const navigate = useNavigate();
    return <><output data-location>{location.search}</output><button data-back onClick={() => navigate(-1)}>Back</button><TaskListPage /></>;
  }
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks${query}`]}><Routes><Route path="/:locale/tasks" element={<Page />} /></Routes></MemoryRouter></QueryClientProvider>));
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); };
  await settle();
  return {
    container, list, settle, client,
    params: () => new URLSearchParams(container.querySelector("[data-location]")!.textContent!),
    click: async (selector: string) => { await act(async () => { const button = container.querySelector<HTMLButtonElement>(selector)!; button.focus(); button.click(); }); await settle(); },
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); list.mockRestore(); },
  };
}

for (const locale of ["zh-CN", "en-US"] as const) {
  describe(`project list (${locale})`, () => {
    it("blocks creation without an organization and unlocks after assignment", async () => {
      const page = await mount(locale, "", 0, [], false);
      const create = vi.spyOn(projectService, "createDraft");
      try {
        const buttons = Array.from(page.container.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.includes(i18n.t("common.createTask")));
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        expect(buttons.every(button => button.disabled)).toBe(true);
        expect(page.container.querySelector('#task-organization-required')?.textContent).toBe(i18n.t("errors.project.organizationRequired"));
        await page.click('.task-create-button');expect(create).not.toHaveBeenCalled();
        await act(async () => page.client.setQueryData(["current-user"], { id: "customer", organization: { id: "org", name: "Assigned Organization" } }));await page.settle();
        expect(page.container.querySelector<HTMLButtonElement>('.task-create-button')!.disabled).toBe(false);
        expect(page.container.querySelector('#task-organization-required')).toBeNull();
      } finally {create.mockRestore();await page.close();}
    });

    it.each([false, true])("confirms deletion (returned=%s) in the app, supports cancel, blocks duplicate requests and retains failures for retry", async (returned) => {
      const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
      const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
      Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
      const item: TaskSummary = { id: "draft-1", version: 7, workflowStatus: returned ? "awaiting_customer" : "new", projectName: "Project", bookTitle: "Book to delete", authorName: "Author", clientName: "Client", status: "draft", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
      const page = await mount(locale, "", 1, [item]);
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const remove = vi.spyOn(projectService, "deleteDraft").mockImplementation(() => new Promise<void>((ok, fail) => { resolve = ok; reject = fail; }));
      const stats = vi.spyOn(projectService, "getStats").mockResolvedValue({ total: 0, drafts: 0, active: 0, completed: 0, actionRequired: 0 });
      const nativeConfirm = vi.spyOn(window, "confirm");
      try {
        await page.click(".task-delete");
        expect(page.container.querySelector("dialog")?.textContent).toContain(item.bookTitle);
        expect(document.activeElement?.textContent).toBe(i18n.t("common.cancel"));
        expect(page.container.querySelector("dialog h2")?.textContent).toBe(i18n.t(returned ? "tasks.deleteReturnedTitle" : "tasks.deleteDialogTitle"));
        await page.click(".delete-draft-actions .button-secondary");
        expect(page.container.querySelector("dialog")).toBeNull();
        expect(remove).not.toHaveBeenCalled();
        await page.click(".task-delete");
        await act(async () => page.container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
        expect(page.container.querySelector("dialog")).toBeNull();
        await page.click(".task-delete");
        await act(async () => { const button = page.container.querySelector<HTMLButtonElement>(".delete-draft-confirm")!; button.click(); button.click(); });
        await page.settle();
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenLastCalledWith("draft-1", 7, locale);
        expect(page.container.querySelector<HTMLButtonElement>(".delete-draft-confirm")!.disabled).toBe(true);
        await act(async () => page.container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
        expect(page.container.querySelector("dialog")).not.toBeNull();
        await act(async () => reject(new Error("offline"))); await page.settle();
        expect(page.container.querySelector("dialog [role=alert]")?.textContent).toBe(i18n.t("tasks.deleteDraftFailed"));
        expect(page.container.querySelector<HTMLButtonElement>(".delete-draft-confirm")!.disabled).toBe(false);
        await page.click(".delete-draft-confirm");
        page.list.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
        await act(async () => resolve()); await page.settle();
        expect(page.container.querySelector("dialog")).toBeNull();
        expect(page.container.querySelector(".task-delete")).toBeNull();
        expect(remove).toHaveBeenCalledTimes(2);
        expect(document.activeElement).toBe(page.container.querySelector(".task-create-button"));
        expect(nativeConfirm).not.toHaveBeenCalled();
      } finally {
        await page.close(); remove.mockRestore(); stats.mockRestore(); nativeConfirm.mockRestore();
        if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
        if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
      }
    });

    it("submits visible search, preserves status/sort, resets pagination and restores search with Back", async () => {
      const page = await mount(locale, "?q=old&status=draft&sort=author&direction=asc&page=2");
      try {
        const input = page.container.querySelector<HTMLInputElement>('input[type="search"]')!;
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  New book  ");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          page.container.querySelector('form[role="search"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        await page.settle();
        expect(page.params().get("q")).toBe("New book");
        expect(page.params().get("status")).toBe("draft");
        expect(page.params().get("sort")).toBe("author");
        expect(page.params().has("page")).toBe(false);
        expect(page.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "New book", status: "draft", sort: "author", direction: "asc", page: 1 }));
        await page.click("[data-back]");
        expect(input.value).toBe("old");
        expect(page.params().get("page")).toBe("2");
      } finally { await page.close(); }
    });

    it("removes individual chips and clears filters while retaining sort", async () => {
      const page = await mount(locale, "?q=book&status=draft&sort=author&direction=asc&page=2");
      try {
        await page.click(".task-filter-chip");
        expect(page.params().has("q")).toBe(false);
        expect(page.params().get("status")).toBe("draft");
        expect(page.container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
        await page.click(".task-clear-filters");
        expect(page.params().get("sort")).toBe("author");
        expect(page.params().get("direction")).toBe("asc");
        expect(page.params().has("status")).toBe(false);
        expect(page.container.querySelector(".task-filter-chips")).toBeNull();
      } finally { await page.close(); }
    });

    it("clears an unsubmitted search draft together with the status filter", async () => {
      const page = await mount(locale, "?status=draft");
      try {
        const input = page.container.querySelector<HTMLInputElement>('input[type="search"]')!;
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unsubmitted");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.click(".task-clear-filters");
        expect(input.value).toBe("");
        expect(page.params().has("status")).toBe(false);
      } finally { await page.close(); }
    });

    it("changes mobile sort through the same server query and preserves filters", async () => {
      const page = await mount(locale, "?q=book&status=draft&page=2");
      try {
        const select = page.container.querySelector<HTMLSelectElement>(".task-mobile-sort select")!;
        await act(async () => { select.value = "project:asc"; select.dispatchEvent(new Event("change", { bubbles: true })); });
        await page.settle();
        expect(page.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "book", status: "draft", sort: "project", direction: "asc", page: 1 }));
        await act(async () => { select.value = "updated:desc"; select.dispatchEvent(new Event("change", { bubbles: true })); });
        await page.settle();
        expect(page.params().has("sort")).toBe(false);
        expect(page.params().get("q")).toBe("book");
      } finally { await page.close(); }
    });

    it.each([
      ["", "tasks.emptyTitle"],
      ["?q=unknown", "tasks.listUx.noResultsTitle"],
      ["?status=draft", "tasks.listUx.noResultsTitle"],
      ["?status=action_required", "tasks.listUx.noActionTitle"],
      ["?status=action_required&q=unknown", "tasks.listUx.noResultsTitle"],
    ])("shows the correct empty state for %s", async (query, key) => {
      const page = await mount(locale, query, 0);
      try {
        expect(page.container.querySelector(".empty-state h2")?.textContent).toBe(i18n.t(key));
        expect(page.container.textContent).not.toContain("tasks.listUx.");
        if (query) {
          await page.click(".empty-state button");
          expect(page.params().has("status")).toBe(false);
          expect(page.params().has("q")).toBe(false);
        } else expect(page.container.querySelector(".empty-state button")?.textContent).toBe(i18n.t("common.createTask"));
      } finally { await page.close(); }
    });
  });
}
