import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useWizardNavigate, wizardDirection } from "./wizard-motion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("wizard transitions", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    it(`detects forward, backward and direct jumps only within the same draft (${locale})`, () => {
      const path = (step: string) => `/${locale}/tasks/a/edit/${step}`;
      expect(wizardDirection(path("project"), path("characters"))).toBe("forward");
      expect(wizardDirection(path("project"), path("review"))).toBe("forward");
      expect(wizardDirection(path("review"), path("characters"))).toBe("back");
      expect(wizardDirection(path("characters"), path("characters"))).toBeUndefined();
      expect(wizardDirection(path("project"), `/${locale}/tasks/b/edit/review`)).toBeUndefined();
      expect(wizardDirection(path("project"), `/${locale}/tasks`)).toBeUndefined();
    });
  }

  for (const mode of ["animated", "reduced", "unsupported"] as const) {
    it(`navigates data routes without animating local updates (${mode})`, async () => {
      // jsdom's AbortSignal and Node's native Request belong to different realms.
      const { transferableAbortController } = await vi.importActual<{ transferableAbortController: () => AbortController }>("node:util");
      vi.stubGlobal("AbortController", class { constructor() { return transferableAbortController(); } });
      const transition = vi.fn((callback: () => Promise<void>) => {
        const finished = Promise.resolve().then(callback);
        return { ready: Promise.resolve(), updateCallbackDone: finished, finished, skipTransition: vi.fn() };
      });
      const original = Object.getOwnPropertyDescriptor(document, "startViewTransition");
      Object.defineProperty(document, "startViewTransition", { configurable: true, value: mode === "unsupported" ? undefined : transition });
      vi.stubGlobal("matchMedia", () => ({ matches: mode === "reduced" }));
      function Page() {
        const navigate = useWizardNavigate();
        const [value, setValue] = useState(0);
        return <><button id="edit" onClick={() => setValue(value + 1)}>{value}</button><button id="next" onClick={() => void navigate("/zh-CN/tasks/a/edit/characters")}>Next</button></>;
      }
      const router = createMemoryRouter([{ path: "/:locale/tasks/:taskId/edit", children: [
        { path: "project", element: <Page /> },
        { path: "characters", lazy: async () => ({ Component: () => <div id="destination" /> }) },
      ] }], { initialEntries: ["/zh-CN/tasks/a/edit/project"] });
      const container = document.createElement("div"); document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => root.render(<RouterProvider router={router} />));
        await act(async () => container.querySelector<HTMLButtonElement>("#edit")!.click());
        expect(transition).not.toHaveBeenCalled();
        await act(async () => container.querySelector<HTMLButtonElement>("#next")!.click());
        expect(container.querySelector("#destination")).not.toBeNull();
        expect(transition).toHaveBeenCalledTimes(mode === "animated" ? 1 : 0);
      } finally {
        await act(async () => root.unmount()); container.remove(); router.dispose(); vi.unstubAllGlobals();
        if (original) Object.defineProperty(document, "startViewTransition", original);
        else Reflect.deleteProperty(document, "startViewTransition");
      }
    });
  }
});
