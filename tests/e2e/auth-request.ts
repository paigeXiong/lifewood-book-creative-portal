import { test, expect, type Page, type APIResponse, type APIRequestContext } from "@playwright/test";

// A full suite shares the production IP login limiter. Respect its explicit cooldown;
// never retry bad credentials, other failures, or ambiguous network errors.
export async function postAuthentication(
  request: APIRequestContext,
  url: string,
  options: Parameters<APIRequestContext["post"]>[1],
) {
  const response = await request.post(url, options);
  if (response.status() !== 429) return response;
  const seconds = Number(response.headers()["retry-after"]);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return response;
  const delay = seconds * 1000 + 250;
  test.setTimeout(test.info().timeout + delay + 5000);
  await response.dispose();
  await new Promise(resolve => setTimeout(resolve, delay));
  return request.post(url, options);
}

// Existing bilingual scenarios explicitly select the account language before
// navigating. Redirect-specific tests use page.goto directly instead.
export async function gotoInAccountLocale(page: Page, url: string) {
  const language = new URL(url, "http://127.0.0.1:5194").pathname.match(/^\/(zh-CN|en-US)(?:\/|$)/)?.[1];
  if (language) {
    const response = await page.request.get("http://127.0.0.1:5194/api/me");
    if (response.ok()) {
      const account = await response.json();
      if (account.locale !== language) {
        const csrf = (await (await page.request.get("http://127.0.0.1:5194/api/auth/csrf")).json()).token;
        const saved = await withRateLimitCooldown(() => page.request.put("http://127.0.0.1:5194/api/me/preferences", {headers: {"X-CSRF-TOKEN": csrf}, data: {locale: language}}));
        expect(saved.ok()).toBeTruthy();
      }
    } else expect(response.status()).toBe(401);
  }
  return page.goto(url);
}

// A 429 response confirms the write was rejected. Respect the server window;
// never retry network failures or ambiguous responses from accepted writes.
export async function withRateLimitCooldown(operation: () => Promise<APIResponse>) {
  const response = await operation();
  if (response.status() !== 429) return response;
  const seconds = Number(response.headers()["retry-after"]);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return response;
  const delay = seconds * 1000 + 250;
  test.setTimeout(test.info().timeout + delay + 5000);
  await response.dispose();
  await new Promise(resolve => setTimeout(resolve, delay));
  return operation();
}
