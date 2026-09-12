const controlSelector = 'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]';

function available(element: HTMLElement): boolean {
  if (element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

export function focusFormControl(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  element.focus({ preventScroll: true });
  const visibleTarget = element.closest<HTMLElement>("label") ?? element;
  visibleTarget.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
}

/** Locate a usable control, including an expanded optional section or a grouped choice. */
export function focusSaveIssue(path: string) {
  requestAnimationFrame(() => {
    const names = path === "videoDurationId" || path === "customVideoDuration" ? ["videoDurationInput", path] : [path];
    const named = names.flatMap(name => Array.from(document.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"]`)));
    const target = path === "characters" ? document.getElementById("characters-error-target") : null;
    const invalid = Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"]'));
    const candidates = [...named, ...(target ? [target] : []), ...invalid.flatMap(item => item.matches(controlSelector) ? [item] : Array.from(item.querySelectorAll<HTMLElement>(controlSelector)))];
    const input = candidates.find(available);
    if (input) focusFormControl(input);
  });
}
