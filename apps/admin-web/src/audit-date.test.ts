import { describe, expect, it } from "vitest";
import { auditDayBoundary } from "./AuditPage";

describe("audit date boundaries", () => {
  it("converts a selected local day to complete UTC bounds", () => {
    const start = auditDayBoundary("2026-08-26", false);
    const end = auditDayBoundary("2026-08-26", true);

    expect(start).toMatch(/^2026-08-(25|26)T/);
    expect(end).toMatch(/^2026-08-(26|27)T/);
    expect(new Date(end!).getTime()).toBe(new Date(2026, 7, 27).getTime());
    expect(new Date(end!).getTime()).toBeGreaterThan(new Date(start!).getTime());
  });

  it("omits empty date filters", () => {
    expect(auditDayBoundary("", false)).toBeUndefined();
  });
});
