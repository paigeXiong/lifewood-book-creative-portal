/** Validate untrusted link values at the rendering boundary, including historical data. */
export function safeLinkUrl(value: string | null | undefined, allowRootRelative = false): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  // Reject control-character protocol obfuscation and browser backslash normalization.
  if (!candidate || /[\\\u0000-\u001f\u007f]/.test(candidate)) return undefined;
  try {
    if (allowRootRelative && candidate.startsWith("/") && !candidate.startsWith("//")) {
      const url = new URL(candidate, "https://local.invalid");
      return url.origin === "https://local.invalid" ? url.pathname + url.search + url.hash : undefined;
    }
    if (!/^https?:\/\//i.test(candidate)) return undefined;
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
