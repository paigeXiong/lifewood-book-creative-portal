import { describe, expect, it, vi, afterEach } from "vitest";
import { focusSaveIssue } from "./form-focus";

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function frame() { vi.stubGlobal("CSS", { escape: (value: string) => value }); vi.stubGlobal("requestAnimationFrame", (callback:FrameRequestCallback) => { callback(0); return 1; }); }
describe("validation focus", () => {
  it("opens collapsed sections and skips disabled or filtered options", () => {
    frame();document.body.innerHTML='<details><summary>Options</summary><input name="genreId" disabled><label hidden><input name="genreId"></label><label class="choice-chip"><input name="genreId"><span>Available</span></label></details>';
    const chip=document.querySelector<HTMLElement>(".choice-chip")!;chip.scrollIntoView=vi.fn();
    focusSaveIssue("genreId");
    expect(document.querySelector("details")!.open).toBe(true);
    expect(document.activeElement).toBe(chip.querySelector("input"));
    expect(chip.scrollIntoView).toHaveBeenCalledWith({block:"center",inline:"nearest",behavior:"instant"});
  });
  it("supports custom duration and the catalog-only duration control", () => {
    frame();document.body.innerHTML='<input name="videoDurationInput"><input name="videoDurationId" disabled>';
    focusSaveIssue("customVideoDuration");expect(document.activeElement).toBe(document.querySelector('[name="videoDurationInput"]'));
    document.body.innerHTML='<input name="videoDurationId" type="radio">';
    focusSaveIssue("videoDurationId");expect(document.activeElement).toBe(document.querySelector("input"));
  });
  it("focuses the control inside an invalid group and ignores inert and CSS-hidden inputs", () => {
    frame();document.body.innerHTML='<div inert><input name="tone"></div><div style="display:none"><input name="tone"></div><fieldset aria-invalid="true"><legend>Tone</legend><input name="visible-tone"></fieldset>';
    focusSaveIssue("tone");expect(document.activeElement).toBe(document.querySelector('[name="visible-tone"]'));
  });
  it("focuses the role creation section when the character list is empty", () => {
    frame();document.body.innerHTML='<section id="characters-error-target" tabindex="-1"></section>';
    focusSaveIssue("characters");expect(document.activeElement).toBe(document.querySelector("section"));
  });
});
