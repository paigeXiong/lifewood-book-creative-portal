import { test, type APIRequestContext } from "@playwright/test";

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
