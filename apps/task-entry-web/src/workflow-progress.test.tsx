import { RevisionNavigation } from "./revision-navigation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, optionService, projectService } from "@lifewood/api-client";
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

  for (const locale of ["zh-CN","en-US"]) it("routes returned project validation errors to references ("+locale+")",async()=>{
    await i18n.changeLanguage(locale);
    const draft=completeDraft();
    draft.book.title="";
    draft.project.audienceIds=[];
    draft.voiceAndReferences.voiceover={narrationEnabled:false,selectedVoiceIds:[]};
    const catalog:FormOptions={
      brands:[],videoGoals:[],audiences:[],genres:[],contentLanguages:[],videoDurations:[],
      publishingPlatforms:[],taskStatuses:[],roleTypes:[],ageRanges:[],genders:[],visualStyles:[],
      moodTags:[],imageStyleTags:[],paceTags:[],narrationTones:[],speechRates:[],voiceGenders:[],
      voiceAges:[],accents:[],voiceEmotions:[],voiceTags:[],sourceCategories:[],referenceCategories:[],
      maxSelectedVoices:3,workflowStatuses:[],projectPriorities:[],
    };
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
    client.setQueryData(["project",draft.id],draft);client.setQueryData(["form-options",locale],catalog);
    const validate=vi.spyOn(projectService,"validateProject").mockResolvedValue({valid:false,fieldErrors:[{field:"project.audienceIds",code:"required"}]});
    const submit=vi.spyOn(projectService,"submitProject");
    const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
    try{
      await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/"+locale+"/tasks/"+draft.id+"/edit/review"]}><Routes><Route path="/:locale/tasks/:taskId/edit/review" element={<RevisionNavigation.Provider value={["references","review"]}><UpcomingStepPage/></RevisionNavigation.Provider>}/></Routes></MemoryRouter></QueryClientProvider>));
      const button=Array.from(container.querySelectorAll("button")).find(b=>b.textContent===i18n.t("clientUx.resubmit"))!;
      expect(button).toBeTruthy();
      await act(async()=>{button.click();await new Promise(r=>setTimeout(r,10));});
      expect(validate).toHaveBeenCalledOnce();expect(submit).not.toHaveBeenCalled();
      expect(container.querySelector(".validation-summary a")?.getAttribute("href")).toBe("/"+locale+"/tasks/"+draft.id+"/edit/references");
      expect(container.querySelector('a[href$="/edit/project"]')).toBeNull();
    }finally{await act(async()=>root.unmount());container.remove();client.clear();vi.restoreAllMocks();}
  });
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

describe("sequential upload queue", () => {
 for (const locale of ["zh-CN", "en-US"] as const) {
  for (const stage of ["project", "references"] as const) {
   it(`cancels a waiting file and uploads the remaining files with the latest version (${stage}, ${locale})`, async () => {
    await i18n.changeLanguage(locale);
    const draft = completeDraft();
    const category = { id: "upload-test", label: "Attachments", description: "PDF", accept: ["application/pdf"], maxBytes: 20000000, maxFiles: 4, required: true, allowsUrl: false };
    const catalog: FormOptions = {
     brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [], publishingPlatforms: [],
     taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [], moodTags: [], imageStyleTags: [], paceTags: [],
     narrationTones: [], speechRates: [], voiceGenders: [], voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [],
     sourceCategories: stage === "project" ? [category] : [], referenceCategories: stage === "references" ? [category] : [],
     maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    client.setQueryData(["project", draft.id], draft);
    client.setQueryData(["form-options", locale], catalog);
    type UploadResult = Awaited<ReturnType<typeof projectService.uploadAsset>>;
    const pending: Array<(result: UploadResult) => void> = [];
    const upload = vi.spyOn(projectService, "uploadAsset").mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const save = vi.spyOn(projectService, "saveDraft").mockImplementation(async (_id, value) => ({ ...value, version: value.version + 1 }));
    const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
    const rows = () => [...c.querySelectorAll<HTMLLIElement>(".transfer-list li")];
    const row = (name: string) => rows().find(item => item.querySelector("span")?.textContent === name)!;
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
    try {
     await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/${stage}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/:step" element={stage === "project" ? <ProjectFormPage/> : <VoiceAndReferencesPage stage="references"/>}/></Routes></MemoryRouter></QueryClientProvider>));
     const input = c.querySelector<HTMLInputElement>(`#${stage === "project" ? "source-upload" : "upload"}-upload-test`)!;
     const files = ["first.pdf", "cancel.pdf", "third.pdf"].map(name => new File(["pdf"], name, { type: "application/pdf" }));
     Object.defineProperty(input, "files", { configurable: true, value: files });
     await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await settle(); });
     expect(upload).toHaveBeenCalledTimes(1);
     expect(row("first.pdf").querySelector("small")!.textContent).toBe(i18n.t("voice.uploading"));
     expect(row("cancel.pdf").querySelector("small")!.textContent).toBe(locale === "zh-CN" ? "等待上传…" : "Waiting to upload…");
     await act(async () => row("cancel.pdf").querySelector<HTMLButtonElement>("button")!.click());
     expect(row("cancel.pdf")).toBeUndefined();
     expect(upload.mock.calls[0][5]!.aborted).toBe(false);
     const first = { ...asset(category.id), id: "first", fileName: "first.pdf" };
     const firstDraft = { ...draft, version: 2, book: { ...draft.book, sourceAssets: [...draft.book.sourceAssets, ...(stage === "project" ? [first] : [])] }, voiceAndReferences: { ...draft.voiceAndReferences, assets: stage === "references" ? [first] : [] } };
     await act(async () => { pending[0]({ asset: first, draft: firstDraft }); await settle(); });
     expect(upload).toHaveBeenCalledTimes(2);
     expect(upload.mock.calls[1][3].name).toBe("third.pdf");
     expect(upload.mock.calls[1][1]).toBe(2);
     expect(row("third.pdf").querySelector("small")!.textContent).toBe(i18n.t("voice.uploading"));
     const third = { ...first, id: "third", fileName: "third.pdf" };
     const finalDraft = { ...firstDraft, version: 3, book: { ...firstDraft.book, sourceAssets: [...firstDraft.book.sourceAssets, ...(stage === "project" ? [third] : [])] }, voiceAndReferences: { ...firstDraft.voiceAndReferences, assets: stage === "references" ? [first, third] : [] } };
     await act(async () => { pending[1]({ asset: third, draft: finalDraft }); await settle(); });
     expect(rows()).toHaveLength(0);
     expect(upload.mock.calls.map(call => call[3].name)).toEqual(["first.pdf", "third.pdf"]);
    } finally {
     await act(async () => root.unmount()); c.remove(); client.clear(); upload.mockRestore(); save.mockRestore();
    }
   });
  }
 }
});

describe("unsaved form protection after a failed background refresh", () => {
  it.each(["project", "characters", "voice"] as const)("retains dirty protection on the %s error screen", async stage => {
    await i18n.changeLanguage("zh-CN");
    const locale = "zh-CN";
        const catalog: FormOptions = {
          brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [], publishingPlatforms: [],
          taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [], moodTags: [{ id: "warm", label: "Warm" }], imageStyleTags: [], paceTags: [],
          narrationTones: [], speechRates: [], voiceGenders: [], voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [],
          sourceCategories: [], referenceCategories: [], maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
        };
    const draft = completeDraft();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["project", draft.id], draft);
    client.setQueryData(["form-options", locale], catalog);
    client.setQueryData(["voices", locale], []);
    const read = vi.spyOn(optionService, "getFormOptions").mockRejectedValue(new Error("offline"));
    const saveProject = vi.spyOn(projectService, "saveDraft").mockImplementation(() => new Promise(() => {}));
    const saveCreative = vi.spyOn(projectService, "saveCreative").mockImplementation(() => new Promise(() => {}));
    const saveVoice = vi.spyOn(projectService, "saveVoiceAndReferences").mockImplementation(() => new Promise(() => {}));
    const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
    try {
      const element = stage === "project" ? <ProjectFormPage/> : stage === "characters" ? <CreativeFormPage stage="characters"/> : <VoiceAndReferencesPage stage="voice"/>;
      await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/${stage}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/:stage" element={element}/></Routes></MemoryRouter></QueryClientProvider>));
      const input = c.querySelector<HTMLInputElement | HTMLTextAreaElement>(stage === "project" ? "#title" : stage === "characters" ? '[id^="characterName-"]' : "#pronunciation-notes")!;
      await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(input,"Unsaved change"); input.dispatchEvent(new Event("input",{bubbles:true})); });
      expect(document.body.dataset.unsavedChanges).toBe("true");
      await act(async () => { await client.invalidateQueries({queryKey:["form-options",locale]}); await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(read).toHaveBeenCalled();
      expect(c.querySelector("form")).toBeNull();
      expect(document.body.dataset.unsavedChanges).toBe("true");
      const event = new Event("beforeunload", {cancelable:true}); window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } finally { await act(async () => root.unmount()); c.remove(); client.clear(); read.mockRestore(); saveProject.mockRestore(); saveCreative.mockRestore(); saveVoice.mockRestore(); }
  });
});


describe("save recovery actions", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it.each(["project", "characters", "voice"] as const)(`retains input and recovers failed saves on %s (${locale})`, async stage => {
      await i18n.changeLanguage(locale); vi.useFakeTimers();
        const catalog: FormOptions = {
          brands: [], videoGoals: [], audiences: [], genres: [], contentLanguages: [], videoDurations: [], publishingPlatforms: [],
          taskStatuses: [], roleTypes: [], ageRanges: [], genders: [], visualStyles: [], moodTags: [{ id: "warm", label: "Warm" }], imageStyleTags: [], paceTags: [],
          narrationTones: [], speechRates: [], voiceGenders: [], voiceAges: [], accents: [], voiceEmotions: [], voiceTags: [],
          sourceCategories: [], referenceCategories: [], maxSelectedVoices: 3, workflowStatuses: [], projectPriorities: [],
        };
      const draft = completeDraft();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
      client.setQueryData(["project", draft.id], draft); client.setQueryData(["form-options", locale], catalog); client.setQueryData(["voices", locale], []);
      let fail = true;
      const save = vi.spyOn(projectService, stage === "project" ? "saveDraft" : stage === "characters" ? "saveCreative" : "saveVoiceAndReferences").mockImplementation(async (...args) => {
        const payload = args[1];
        if (fail) throw new Error("offline");
        return { ...payload, version: payload.version + 1 };
      });
      const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
      const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
      const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
      Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(){this.open=true;}});
      Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(){this.open=false;}});
      const selector = stage === "project" ? "#title" : stage === "characters" ? '[id^="characterName-"]' : "#pronunciation-notes";
      const input = () => c.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      const edit = async (value: string) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(input().tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,"value")!.set!.call(input(),value);
          input().dispatchEvent(new Event("input",{bubbles:true}));
          await vi.advanceTimersByTimeAsync(1);
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      };
      const action = () => c.querySelector<HTMLButtonElement>(".save-feedback button")!;
      const confirm = async () => { await act(async () => { [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b=>b.textContent===i18n.t("common.confirmAction"))!.click(); await vi.advanceTimersByTimeAsync(10); }); };
      try {
        const element = stage === "project" ? <ProjectFormPage/> : stage === "characters" ? <CreativeFormPage stage="characters"/> : <VoiceAndReferencesPage stage="voice"/>;
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${locale}/tasks/${draft.id}/edit/${stage}`]}><Routes><Route path="/:locale/tasks/:taskId/edit/:stage" element={element}/></Routes></MemoryRouter></QueryClientProvider>));
        await edit("Local edit");
        expect(save).toHaveBeenCalledTimes(1); expect(input().value).toBe("Local edit");
        expect(action().textContent).toBe(i18n.t("saveRecovery.retry"));
        fail=false;
        await act(async()=>{action().click(); await vi.advanceTimersByTimeAsync(10);});
        expect(save).toHaveBeenCalledTimes(2); expect(c.querySelector(".save-feedback")).toBeNull();
        save.mockRejectedValue(new ApiError({ retryable:false, code:"project.version_conflict", messageKey:"errors.project.versionConflict" }));
        await edit("Conflict edit");
        expect(action().textContent).toBe(i18n.t("saveRecovery.loadLatest"));
        const count=save.mock.calls.length;
        await edit("Keep my latest edit"); expect(save).toHaveBeenCalledTimes(count);
        if (stage === "characters") {
          await act(async()=>client.setQueryData(["project",draft.id],{...draft,version:8}));
          const remove=[...c.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===i18n.t("creative.delete"));
          expect(remove).toBeDefined();
          await act(async()=>remove!.click()); await confirm();
          expect(save).toHaveBeenCalledTimes(count);
          expect(input().value).toBe("Keep my latest edit");
        }
        const read=vi.spyOn(projectService,"getProject").mockRejectedValue(new Error("offline"));
        await act(async()=>action().click()); await confirm();
        expect(input().value).toBe("Keep my latest edit");
        expect(c.textContent).toContain(i18n.t("saveRecovery.reloadFailed"));
        let resolve!: (draft: TaskDraft)=>void;
        read.mockImplementation(()=>new Promise(done=>{resolve=done;}));
        await act(async()=>action().click()); await confirm();
        expect(input().value).toBe("Keep my latest edit");
        const latest={...draft,version:9};
        await edit("Edited while loading");
        await act(async()=>{resolve(latest); await vi.advanceTimersByTimeAsync(10);});
        expect(document.querySelector("dialog")!.textContent).toContain(i18n.t("saveRecovery.changedWhileLoading"));
        await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b=>b.textContent===i18n.t("common.cancel"))!.click(); await vi.advanceTimersByTimeAsync(10);});
        expect(input().value).toBe("Edited while loading");
        await act(async()=>action().click()); await confirm();
        await act(async()=>{resolve(latest); await vi.advanceTimersByTimeAsync(10);});
        expect(input().value).toBe(stage==="project"?"Book":stage==="characters"?"Mara":"");
        expect(c.querySelector(".save-feedback")).toBeNull();
        save.mockImplementation(async (...args)=>({...args[1],version:args[1].version+1}));
        await edit("After reload"); expect(save.mock.calls.at(-1)![1].version).toBe(9);
      } finally {
        await act(async()=>root.unmount()); c.remove(); client.clear(); vi.restoreAllMocks(); vi.useRealTimers();
        if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
        if(close)Object.defineProperty(HTMLDialogElement.prototype,"close",close);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
      }
    });
  }
});
