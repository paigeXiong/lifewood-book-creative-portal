import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoginArtwork } from "./LoginArtwork";

const slides = [
  ["auth.storyTitle", "auth.storyTitleEnd"],
  ["auth.storyCharacters", "auth.storyCharactersEnd"],
  ["auth.storyVision", "auth.storyVisionEnd"],
] as const;

export function LoginStory() {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const storyRef = useRef<HTMLElement>(null);
  const gesture = useRef({ time: 0, delta: 0, locked: false, transitionUntil: 0 });

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (paused || reducedMotion.matches || document.hidden) return;
      timer = setTimeout(() => {
        gesture.current.transitionUntil = performance.now() + 900;
        setActive(index => (index + 1) % slides.length);
      }, 6500);
    };
    schedule();
    reducedMotion.addEventListener("change", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      reducedMotion.removeEventListener("change", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [active, interaction, paused]);

  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !window.matchMedia("(min-width: 901px)").matches || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      const current = gesture.current;
      if (now - current.time > 180) { current.delta = 0; current.locked = false; }
      current.time = now;
      if (current.locked || now < current.transitionUntil) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? story.clientHeight : 1);
      if (Math.sign(delta) !== Math.sign(current.delta)) current.delta = 0;
      current.delta += delta;
      if (Math.abs(current.delta) < 45) return;
      current.locked = true;
      current.transitionUntil = now + 900;
      setInteraction(value => value + 1);
      setActive(index => Math.max(0, Math.min(slides.length - 1, index + Math.sign(delta))));
    };
    story.addEventListener("wheel", onWheel, { passive: false });
    return () => story.removeEventListener("wheel", onWheel);
  }, []);

  return <section className="login-story" ref={storyRef} tabIndex={0} aria-label={t("auth.storyShowcase")} onKeyDown={event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setInteraction(value => value + 1);
    setActive(index => event.key === "Home" ? 0 : event.key === "End" ? slides.length - 1 : Math.max(0, Math.min(slides.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
  }}>
    <div className="login-story-stage">
      {slides.map(([title, end], index) => <div key={title} className="login-story-content" data-position={index === active ? "active" : index < active ? "before" : "after"} aria-hidden={index !== active} inert={index !== active}>
        <h2>{t(title)}<br /><span>{t(end)}</span></h2>
        <LoginArtwork variant={index} />
      </div>)}
    </div>
    <nav className="login-story-pagination" aria-label={t("auth.storyPages")}>
      {slides.map(([title, end], index) => <button type="button" key={title} aria-label={t("auth.storyPage", { number: index + 1, title: `${t(title)} ${t(end)}` })} aria-current={index === active ? "step" : undefined} onClick={() => { setActive(index); setInteraction(value => value + 1); }}><span aria-hidden="true" /></button>)}
      <button type="button" aria-label={t(paused ? "auth.resumeStory" : "auth.pauseStory")} onClick={() => setPaused(value => !value)}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="#deb66b">{paused ? <path d="m3 1 8 5-8 5Z" /> : <path d="M2 1h3v10H2zM7 1h3v10H7z" />}</svg>
      </button>
    </nav>
  </section>;
}
