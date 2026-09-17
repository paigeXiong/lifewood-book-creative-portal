import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MemberActivityCalendar } from "./components/MemberActivityCalendar";
const labels = { calendar: "Activity calendar", logins: "Sign-ins", periods: "Active periods", uncollected: "Not collected", future: "Future date", previousMonth: "Previous month", nextMonth: "Next month", less: "Less", more: "More" };
for (const locale of ["zh-CN", "en-US"] as const) it(`shows calendar coverage, daily details and bounded month navigation (${locale})`, async () => {
  const calendar = { trackedFrom: "2026-09-01", days: [{ date: "2026-08-31", collected: false, logins: 0, activePeriods: 0 }, { date: "2026-09-01", collected: true, logins: 2, activePeriods: 7 }, { date: "2026-09-02", collected: true, logins: 0, activePeriods: 0 }] };
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<MemberActivityCalendar calendar={calendar} labels={labels} locale={locale} />));
    expect(host.querySelectorAll(".member-calendar-day")).toHaveLength(30);
    expect(host.querySelectorAll(".member-calendar-day:disabled")).toHaveLength(28);
    expect(host.querySelector('.member-calendar-day[aria-current="date"]')?.textContent).toBe("2");
    await act(async () => host.querySelector<HTMLButtonElement>(".member-calendar-day")!.click());
    expect(host.querySelector(".member-calendar-detail")?.textContent).toContain("Sign-ins2Active periods7");
    expect(host.querySelector(".member-calendar-day.level-3")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click());
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.disabled).toBe(true);
    expect(host.querySelector(".member-calendar-detail")?.textContent).toContain("Not collected");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click());
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); }
});
