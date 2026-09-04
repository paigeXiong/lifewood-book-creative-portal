import { describe, expect, it } from "vitest";
import { isAiSettings, requireAiSettings } from "./ai-settings-data";

const current = {
  labels: { title: "AI" },
  protocols: [{ id: "openai", label: "OpenAI", endpointPlaceholder: "https://example.test" }],
  providers: [{ id: "a", name: "A", protocol: "openai", endpoint: "https://example.test", model: "", models: ["vision"], hasApiKey: true }],
  bindings: [{ featureId: "book-recognition", label: "Cover", model: "vision", enabled: true, providerId: "a" }],
};
describe("AI settings response validation", () => {
  it("rejects cached single-provider responses without reading a missing list", () => {
    const legacy = { enabled: true, endpoint: "https://example.test", model: "vision", labels: {} };
    expect(isAiSettings(legacy)).toBe(false);
    expect(() => requireAiSettings(legacy)).toThrow();
  });
  it("rejects older providers without a model catalog", () => {
    expect(isAiSettings({ ...current, providers: [{ ...current.providers[0], models: undefined }] })).toBe(false);
    expect(isAiSettings({ ...current, bindings: undefined })).toBe(false);
    expect(isAiSettings({ ...current, protocols: [] })).toBe(false);
  });
  it("accepts migrated settings and empty catalogs with unassigned features", () => {
    expect(requireAiSettings(current)).toBe(current);
    expect(isAiSettings({ ...current, providers: [], bindings: [{ ...current.bindings[0], enabled: false, providerId: undefined, model: "" }] })).toBe(true);
  });
});
