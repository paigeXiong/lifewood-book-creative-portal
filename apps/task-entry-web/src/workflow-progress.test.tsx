import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { optionService, projectService } from "@lifewood/api-client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormOptions, ReferenceAsset, TaskDraft } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import { StepProgress } from "./components/StepProgress";
import { getHighestReachableStep } from "./workflow-progress";
import { ProjectFormPage } from "./pages/ProjectFormPage";
import { CreativeFormPage } from "./pages/CreativeFormPage";
import { VoiceAndReferencesPage } from "./pages/VoiceAndReferencesPage";
import { UpcomingStepPage } from "./pages/UpcomingStepPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asset = (categoryId: string): ReferenceAsset => ({
  id: categoryId,
  categoryId,
  fileName: `${categoryId}.pdf`,
  contentType: "application/pdf",
  sizeBytes: 1,
  url: `/files/${categoryId}`,
});

const completeDraft = (): TaskDraft => ({
  id: "task-1",
  status: "draft",
  version: 1,
  createdAt: "2026-09-02T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  project: { clientName: "Client", contactName: "Contact", email: "contact@example.com", projectName: "Project", videoGoalId: "preview", audienceIds: ["general"] },
  book: { title: "Book", authorName: "Author", genreId: "fiction", sellingPoint: "Hook", synopsis: "Synopsis", contentLanguageId: "en-US", videoDurationId: "short", publishingPlatformIds: [], sourceAssets: [asset("book-cover"), asset("manuscript")] },
  creative: { characters: [{ id: "character-1", roleTypeId: "protagonist", name: "Mara", storyRole: "Lead", personality: "Curious", appearance: "Traveler", referenceImageUrls: [], referenceImages: [] }], visualStyleId: "cinematic", moodTagIds: [], imageStyleTagIds: [], paceTagIds: [], styleReferenceImageUrls: [], styleReferenceImages: [] },
  voiceAndReferences: { voiceover: { contentLanguageId: "en-US", narrationToneId: "warm", speechRateId: "medium", selectedVoiceIds: [] }, assets: [], competitorUrls: [], creativeDirection: { coreMessage: "Choose courage." } },
});

describe("workflow progress", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const stage of ["characters", "style", "voice", "references"] as const) {
      it(`silently saves ${stage} and returns home with the latest changes (${locale})`, async () => {
        await i18n.changeLanguage(locale);
        vi.useFakeTimers();
        const draft = completeDraft();
        const catalog: FormOptions = {
          brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [], publishingPlatforms: [],
          taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [], moodTags: [{ id: "warm", label: "Warm" }], imageStyleTags: [], paceTags: [],
          narrationTones: [], speechRates: [], voiceGenders: [], voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [],
          sourceCategories: [], referenceCategories: [], maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
        };
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
        client.setQueryData(["project", draft.id], draft);
        client.setQueryData(["form-options", locale], catalog);
        client.setQueryData(["voices", locale], []);
        const requests: Array<{ payload: TaskDraft; resolve: (value: TaskDraft) => void; reject: (error: Error) => void }> = [];
        const save = vi.spyOn(projectService, stage === "characters" || stage === "style" ? "saveCreative" : "saveVoiceAndReferences").mockImplementation((...args) => new Promise((resolve, reject) => requests.push({ payload: args[1], resolve, reject })));
        const container = document.createElement("div"); document.body.append(container);
        const root = createRoot(container);
        const home = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("common.backHome"))!;
        const readValue = (payload: TaskDraft) => stage === "characters" ? payload.creative.characters[0].name : stage === "style" ? payload.creative.moodTagIds.length : stage === "voice" ? payload.voiceAndReferences.voiceover.pronunciationNotes : payload.voiceAndReferences.creativeDirection.coreMessage;
        const edit = async (value: string) => {
          await act(async () => {
            if (stage === "style") { container.querySelector<HTMLInputElement>('input[name="moodTagIds"]')!.click(); return; }
            const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(stage === "characters" ? '[id^="characterName-"]' : stage === "voice" ? '#pronunciation-notes' : '#core-message')!;
            const prototype = input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
        };
        try {
          const page = stage === "characters" || stage === "style" ? <CreativeFormPage stage={stage} /> : <VoiceAndReferencesPage stage={stage} />;
          await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/${stage}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/:stage" element={page} /><Route path="/:locale/tasks" element={<div data-testid="home" />} /></Routes></MemoryRouter></QueryClientProvider>));
          expect(home()).toBeDefined();
          expect(container.textContent).not.toContain(i18n.t("common.saveNow"));
          await edit("First change");
          await act(async () => { await vi.advanceTimersByTimeAsync(1); });
          expect(save).toHaveBeenCalledTimes(1);
          expect(container.querySelector('.save-state')).toBeNull();
          expect(container.querySelector('form[inert]')).toBeNull();
          expect(container.querySelector<HTMLButtonElement>('.sticky-actions button[type="submit"]')?.disabled).toBe(false);
          await edit("Latest change");
          await act(async () => home().click());
          expect(container.querySelector('[data-testid="home"]')).toBeNull();
          await act(async () => { requests[0].resolve({ ...requests[0].payload, version: 2 }); await vi.advanceTimersByTimeAsync(1); });
          expect(save).toHaveBeenCalledTimes(2);
          expect(requests[1].payload.version).toBe(2);
          expect(readValue(requests[1].payload)).toBe(stage === "style" ? 0 : "Latest change");
          await act(async () => { requests[1].reject(new Error("Offline")); await vi.advanceTimersByTimeAsync(1); });
          expect(container.querySelector('[data-testid="home"]')).toBeNull();
          await act(async () => home().click());
          expect(save).toHaveBeenCalledTimes(3);
          await act(async () => { requests[2].resolve({ ...requests[2].payload, version: 3 }); await vi.advanceTimersByTimeAsync(1); });
          expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
        } finally { await act(async () => root.unmount()); container.remove(); client.clear(); save.mockRestore(); vi.useRealTimers(); }
      });
    }
  }

  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const destination of ["home", "characters"] as const) {
    it(`autosaves silently and flushes the latest edit before ${destination} (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      vi.useFakeTimers();
      const draft = completeDraft();
      const catalog: FormOptions = {
        brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [], publishingPlatforms: [],
        taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [], moodTags: [], imageStyleTags: [], paceTags: [],
        narrationTones: [], speechRates: [], voiceGenders: [], voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [],
        sourceCategories: [], referenceCategories: [], maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
      client.setQueryData(["project", draft.id], draft);
      client.setQueryData(["form-options", locale], catalog);
      const requests: Array<{ payload: TaskDraft; resolve: (value: TaskDraft) => void; reject: (error: Error) => void }> = [];
      const save = vi.spyOn(projectService, "saveDraft").mockImplementation((_id, payload) => new Promise((resolve, reject) => requests.push({ payload, resolve, reject })));
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const homeButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("common.backHome"))!;
      const finishButton = () => destination === "home" ? homeButton() : container.querySelector<HTMLButtonElement>('.sticky-actions button[type="submit"]')!;
      const finalTitle = destination === "home" ? "" : "Last title";
      const editTitle = async (value: string) => {
        await act(async () => {
          const input = container.querySelector<HTMLInputElement>("#title")!;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      try {
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/project`]}><Routes><Route path="/:locale/tasks/:taskId/edit/project" element={<ProjectFormPage />} /><Route path="/:locale/tasks" element={<div data-testid="home" />} /><Route path="/:locale/tasks/:taskId/edit/characters" element={<div data-testid="home" />} /></Routes></MemoryRouter></QueryClientProvider>));
        expect(homeButton()).toBeDefined();
        const disabledUploads = [...container.querySelectorAll('.upload-card')].map(card => card.classList.contains('is-disabled'));
        expect(container.textContent).not.toContain(i18n.t("common.saveNow"));
        await editTitle("Updated title");
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(save).toHaveBeenCalledTimes(1);
        expect(requests[0].payload.book.title).toBe("Updated title");
        expect(container.querySelector('.sticky-actions button[type="submit"]')?.textContent).toBe(`${i18n.t("wizard.actions.toCharacters")}→`);
        expect(container.querySelector<HTMLButtonElement>('.sticky-actions button[type="submit"]')?.disabled).toBe(false);
        expect(container.querySelector<HTMLButtonElement>('.step-button')?.disabled).toBe(false);
        expect(container.querySelector('.save-state')).toBeNull();
        expect(container.querySelector('form[inert]')).toBeNull();
        expect([...container.querySelectorAll('.upload-card')].map(card => card.classList.contains('is-disabled'))).toEqual(disabledUploads);
        await editTitle("Second title");
        await act(async () => {
          requests[0].resolve({ ...requests[0].payload, version: 2 });
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(save).toHaveBeenCalledTimes(2);
        expect(requests[1].payload.book.title).toBe("Second title");
        expect(requests[1].payload.version).toBe(2);
        await editTitle(finalTitle);
        await act(async () => finishButton().click());
        expect(container.querySelector('[data-testid="home"]')).toBeNull();
        await act(async () => {
          requests[1].resolve({ ...requests[1].payload, version: 3 });
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(save).toHaveBeenCalledTimes(3);
        expect(requests[2].payload.book.title).toBe(finalTitle);
        expect(requests[2].payload.version).toBe(3);
        await act(async () => {
          requests[2].reject(new Error("Offline"));
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(container.querySelector('[data-testid="home"]')).toBeNull();
        expect(container.querySelector<HTMLInputElement>("#title")?.value).toBe(finalTitle);
        await act(async () => finishButton().click());
        expect(save).toHaveBeenCalledTimes(4);
        await act(async () => {
          requests[3].resolve({ ...requests[3].payload, version: 4 });
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
      } finally {
        await act(async () => root.unmount());
        container.remove(); client.clear(); save.mockRestore(); vi.useRealTimers();
      }
    });
    }
  }

  for(const locale of ["zh-CN","en-US"] as const) {
    it(`shows existing project basics only in step five (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      const draft=completeDraft();
      draft.book.sourceAssets = [asset("book-cover")];
      draft.project.brandId="brand";
      draft.creative.characters[0].ageRangeId = "young-adult";
      draft.creative.characters[0].genderId = "female";
      draft.creative.characters[0].presetId = "protagonist";
      draft.creative.characters.push({ ...draft.creative.characters[0], id: "character-2", name: "Theo", roleTypeId: "supporting", ageRangeId: "adult", genderId: "male", storyRole: "Helps Mara" });
      draft.creative.characters[1].referenceImages = [{...asset("character-reference"), url:"/custom-theo.png"}];
      draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};
      const catalog: FormOptions = {
        brands:[{id:"brand",label:"Brand"}],videoGoals:[{id:"preview",label:"Preview"}],audiences:[{id:"general",label:"General"}],
        genres:[],contentLanguages:[],videoDurations:[],publishingPlatforms:[],taskStatuses:[],roleTypes:[],ageRanges:[],genders:[],visualStyles:[],
        moodTags:[],imageStyleTags:[],paceTags:[],narrationTones:[],speechRates:[],voiceGenders:[],voiceAges:[],accents:[],voiceEmotions:[],voiceTags:[],
        sourceCategories:[],referenceCategories:[],maxSelectedVoices:3,workflowStatuses:[],projectPriorities:[]
      };
      catalog.roleTypes = [{id:"protagonist",label:"Protagonist"},{id:"supporting",label:"Supporting"}];
      catalog.ageRanges = [{id:"young-adult",label:"Young adult"},{id:"adult",label:"Adult"}];
      catalog.genders = [{id:"female",label:"Female"},{id:"male",label:"Male"}];
      for(const stage of ["project","references","characters"] as const) {
        const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
        client.setQueryData(["project",draft.id],draft);client.setQueryData(["form-options",locale],catalog);
        const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
        try {
          await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/${stage}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/project" element={<ProjectFormPage />} /><Route path="/:locale/tasks/:taskId/edit/references" element={<VoiceAndReferencesPage stage="references" />} /><Route path="/:locale/tasks/:taskId/edit/characters" element={<CreativeFormPage stage="characters" />} /><Route path="/:locale/tasks/:taskId/edit/voice" element={<div data-testid="next-step" />} /></Routes></MemoryRouter></QueryClientProvider>));
          expect(container.querySelectorAll("#clientName,#contactName,#email,#phone")).toHaveLength(0);
          expect(container.querySelector(".book-recognition")).toBeNull();
          expect(container.querySelector(".sticky-note")).toBeNull();
          expect(container.querySelectorAll("#brandId,#projectName,#videoGoalId,#deadline,#audience-group")).toHaveLength(stage==="references"?5:0);
          if (stage === "characters") {
            expect(container.querySelector(".casting-card,.character-preset-preview")).toBeNull();
            expect(container.querySelector(".section-heading p,.next-card p")).toBeNull();
            for (const index of [1, 0, 1, 0]) {
              await act(async () => (container.querySelectorAll(".character-roster button")[index] as HTMLButtonElement).click());
              const expected = draft.creative.characters[index];
              expect(container.querySelector(".focused-character-card figcaption strong")?.textContent).toBe(expected.name);
              expect(container.querySelector(".focused-character-card img")?.getAttribute("src")).toBe(index === 0 ? "/character-presets/protagonist.png" : "/custom-theo.png");
              expect(container.querySelector(".character-card-heading strong")?.textContent).toBe(expected.name);
              expect(container.querySelector<HTMLInputElement>('[id^="characterName-"]')?.value).toBe(expected.name);
              expect(container.querySelector<HTMLInputElement>('[id^="roleType-"] input:checked')?.value).toBe(expected.roleTypeId);
              expect(container.querySelector<HTMLInputElement>('[id^="ageRange-"] input:checked')?.value).toBe(expected.ageRangeId);
              expect(container.querySelector<HTMLInputElement>('[id^="gender-"] input:checked')?.value).toBe(expected.genderId);
              expect(container.querySelector<HTMLTextAreaElement>('[id^="storyRole-"]')?.value).toBe(expected.storyRole);
            }
            let finishSave!: (saved: TaskDraft) => void;
            const save = vi.spyOn(projectService, "saveCreative").mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
            try {
              const next = container.querySelector<HTMLButtonElement>(".step-button")!;
              expect(next.disabled).toBe(false);
              await act(async () => next.click());
              expect(save).toHaveBeenCalledOnce();
              expect(container.querySelector('[data-testid="next-step"]')).toBeNull();
              await act(async () => finishSave({ ...draft, version: draft.version + 1 }));
              expect(container.querySelector('[data-testid="next-step"]')).not.toBeNull();
            } finally { save.mockRestore(); }
          }
          if(stage==="references") {
            expect((container.querySelector("#projectName") as HTMLInputElement).value).toBe("Project");
            expect(container.querySelector<HTMLInputElement>("#brandId input:checked")?.value).toBe("brand");
            expect(container.querySelector<HTMLInputElement>('#audience-group input[value="general"]')?.checked).toBe(true);
            await act(async () => { client.setQueryData(["project", draft.id], {...draft,project:{...draft.project,projectName:""}}); await new Promise(resolve => setTimeout(resolve, 0)); });
            expect(container.querySelector<HTMLInputElement>("#projectName")?.value).toBe(draft.book.title);
            expect(container.querySelector('label[for="projectName"]')?.textContent).not.toContain("*");
          }
        } finally { await act(async()=>root.unmount());container.remove();client.clear(); }
      }
      expect(getHighestReachableStep({...draft,project:{...draft.project,projectName:"",videoGoalId:undefined,audienceIds:[]}})).toBe(5);
      expect(getHighestReachableStep(draft)).toBe(6);
    });
  }

  for (const mode of ["review", "detail"] as const) {
    it(`opens ${mode} without narration even when the voice catalog has failed`, async () => {
      await i18n.changeLanguage("zh-CN");
      const draft = completeDraft();
      draft.creative.imageStyleTagIds = ["natural-light", "vintage"];
      draft.voiceAndReferences.voiceover = { narrationEnabled: false, selectedVoiceIds: [] };
      if (mode === "detail") draft.status = "submitted";
      const catalog: FormOptions = {
        brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [],
        publishingPlatforms: [], taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [],
        legacyImageStyleTags: [{ id: "natural-light", label: "自然光" }, { id: "vintage", label: "复古" }],
        moodTags: [], imageStyleTags: [], paceTags: [], narrationTones: [], speechRates: [], voiceGenders: [],
        voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [], sourceCategories: [], referenceCategories: [],
        maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      client.setQueryData(["project", draft.id], draft);
      client.setQueryData(["project", draft.id, "zh-CN"], draft);
      client.setQueryData(["form-options", "zh-CN"], catalog);
      client.setQueryData(["project-deliveries", draft.id, "zh-CN"], []);
      const getVoices = vi.spyOn(optionService, "getVoices").mockRejectedValue(new Error("Voice catalog unavailable"));
      await client.prefetchQuery({ queryKey: ["voices", "zh-CN"], queryFn: () => optionService.getVoices("zh-CN") });
      getVoices.mockClear();
      const validation = vi.spyOn(projectService, "validateProject").mockResolvedValue({ valid: true, fieldErrors: [] });
      const submit = vi.spyOn(projectService, "submitProject").mockResolvedValue({ ...draft, status: "submitted" });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/zh-CN/tasks/${draft.id}/${mode}`]}>
              <Routes>
                <Route path="/:locale/tasks/:taskId/review" element={<UpcomingStepPage />} />
                <Route path="/:locale/tasks/:taskId/detail" element={<TaskDetailPage />} />
                <Route path="/:locale/tasks/:taskId/submitted" element={<p>submission-complete</p>} />
                <Route path="/:locale/tasks/:taskId" element={<p>submission-complete</p>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        ));
        expect(container.textContent).toContain(i18n.t("voice.narration.notRequired"));
        expect(container.textContent).toContain("Choose courage.");
        expect(container.textContent).toContain("自然光");
        expect(container.textContent).toContain("复古");
        expect(getVoices).not.toHaveBeenCalled();
        if (mode === "review") {
          const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === i18n.t("review.submit"))!;
          expect(button.disabled).toBe(false);
          await act(async () => button.click());
          expect(validation).toHaveBeenCalledOnce();
          expect(submit).toHaveBeenCalledOnce();
          expect(container.textContent).toContain("submission-complete");
        }
      } finally {
        act(() => root.unmount());
        container.remove();
        client.clear();
        vi.restoreAllMocks();
      }
    });
  }
  it("derives the highest reachable step from saved draft data", () => {
    const draft = completeDraft();
    expect(getHighestReachableStep(draft)).toBe(6);
    expect(getHighestReachableStep({ ...draft, voiceAndReferences: { ...draft.voiceAndReferences, voiceover: { narrationEnabled: false, selectedVoiceIds: [] } } })).toBe(6);
    expect(getHighestReachableStep({ ...draft, voiceAndReferences: { ...draft.voiceAndReferences, creativeDirection: { coreMessage: "" } } })).toBe(5);
    expect(getHighestReachableStep({ ...draft, creative: { ...draft.creative, visualStyleId: undefined } })).toBe(4);
    expect(getHighestReachableStep({ ...draft, voiceAndReferences: { ...draft.voiceAndReferences, voiceover: { ...draft.voiceAndReferences.voiceover, narrationToneId: undefined } } })).toBe(3);
  });

  it("keeps completed later steps clickable after navigating backward", () => {
    void i18n.changeLanguage("zh-CN");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(
        <MemoryRouter initialEntries={["/zh-CN/tasks/task-1/edit/characters"]}>
          <Routes><Route path="/:locale/tasks/:taskId/edit/characters" element={<StepProgress current={2} highestReachable={6} />} /></Routes>
        </MemoryRouter>,
      ));
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.step-link"));
    expect(Array.from(container.querySelectorAll(".step-label"), (label) => label.textContent)).toEqual([
      "上传图书",
      "故事角色",
      "旁白配音",
      "视觉风格",
      "参考与创意",
      "审阅与提交",
    ]);
    expect(links.find((link) => link.textContent?.includes("旁白配音"))?.getAttribute("href")).toBe("/zh-CN/tasks/task-1/edit/voice");
    expect(links.some((link) => link.textContent?.includes("视觉风格") && link.getAttribute("href") === "/zh-CN/tasks/task-1/edit/style")).toBe(true);
    expect(links.some((link) => link.textContent?.includes("参考与创意") && link.getAttribute("href") === "/zh-CN/tasks/task-1/edit/references")).toBe(true);
    expect(Array.from(container.querySelectorAll(".step-current a")).length).toBe(0);
    act(() => root.unmount());
    container.remove();
  });
});
