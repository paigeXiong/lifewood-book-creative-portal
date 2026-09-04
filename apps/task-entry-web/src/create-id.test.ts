import { describe, expect, it, vi } from "vitest";
import { createId } from "./create-id";

describe("IDs on HTTP LAN origins", () => {
  it("generates distinct UUID v4 values without randomUUID", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const ids = Array.from({ length: 100 }, createId);
      expect(new Set(ids).size).toBe(100);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally { vi.unstubAllGlobals(); }
  });
});
