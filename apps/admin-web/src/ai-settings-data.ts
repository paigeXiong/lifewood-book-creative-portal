import { ApiError, type AiSettings } from "@lifewood/api-client";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every(key => typeof value[key] === "string");
}
export function isAiSettings(value: unknown): value is AiSettings {
  return object(value) && object(value.labels) && Object.values(value.labels).every(label => typeof label === "string")
    && Array.isArray(value.providers) && value.providers.every(p => object(p)
      && strings(p, ["id", "name", "protocol", "endpoint", "model"]) && typeof p.hasApiKey === "boolean"
      && Array.isArray(p.models) && p.models.every(model => typeof model === "string"))
    && Array.isArray(value.protocols) && value.protocols.length > 0
    && value.protocols.every(p => object(p) && strings(p, ["id", "label", "endpointPlaceholder"]))
    && Array.isArray(value.bindings) && value.bindings.every(b => object(b)
      && strings(b, ["featureId", "label", "model"]) && typeof b.enabled === "boolean"
      && (b.providerId == null || typeof b.providerId === "string"));
}
export function requireAiSettings(value: unknown): AiSettings {
  if (!isAiSettings(value)) throw new ApiError({ code: "network.invalidResponse", messageKey: "errors.network.invalidResponse", fallbackMessage: "The server returned an invalid response.", retryable: true });
  return value;
}
