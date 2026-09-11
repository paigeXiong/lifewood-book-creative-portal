import { describe, expect, it } from "vitest";
import { localizedAdminLocation } from "./App";
import { resolveProjectSelection } from "./project-utils";

describe("project deep-link selection", () => {
  it.each([
    "/zh-CN/projects?project=project-42",
    "/en-US/projects?project=project-42",
  ])("preserves the requested project while the list is loading: %s", (path) => {
    const requestedId = new URL(path, "http://localhost").searchParams.get("project") ?? undefined;

    expect(resolveProjectSelection(requestedId, [], false)).toBe("project-42");
  });

  it("keeps a requested project even when it is outside the current page", () => {
    expect(resolveProjectSelection("project-42", ["project-1", "project-2"], true)).toBe("project-42");
  });

  it("selects the first row when no project was requested", () => {
    expect(resolveProjectSelection(undefined, ["project-1", "project-2"], true)).toBe("project-1");
  });
});

describe("localized admin location", () => {
  it("keeps a project deep link and hash when switching to English", () => {
    expect(localizedAdminLocation(
      "/zh-CN/projects",
      "?project=project-42",
      "#workflow",
      "zh-CN",
      "en-US",
    )).toBe("/en-US/projects?project=project-42#workflow");
  });

  it("keeps a project deep link when switching to Chinese", () => {
    expect(localizedAdminLocation(
      "/en-US/projects",
      "?project=project-42",
      "",
      "en-US",
      "zh-CN",
    )).toBe("/zh-CN/projects?project=project-42");
  });
});
