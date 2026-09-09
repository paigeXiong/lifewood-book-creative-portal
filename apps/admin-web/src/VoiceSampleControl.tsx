import { useEffect, useId, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function VoiceSampleControl({ src, name, busy, activeAudio, onUpload, onRemove }: {
  src?: string; name: string; busy: boolean; activeAudio: RefObject<HTMLAudioElement | null>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null), input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false), [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false), [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState<number>(), [position, setPosition] = useState(0);
  const attempt = useRef(0);
  useEffect(() => {
    const element = audio.current;
    return () => { attempt.current++; element?.pause(); if (activeAudio.current === element) activeAudio.current = null; };
  }, [activeAudio]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); more.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    const current = ++attempt.current;
    if (activeAudio.current === element && (playing || waiting)) {
      activeAudio.current = null; element.pause(); setWaiting(false); return;
    }
    if (busy) return;
    activeAudio.current?.pause(); activeAudio.current = element;
    setWaiting(true);
    if (failed) { setFailed(false); element.load(); }
    try {
      await element.play();
      if (current !== attempt.current || activeAudio.current !== element) { element.pause(); return; }
      setPlaying(true); setWaiting(false);
    } catch {
      if (current !== attempt.current || activeAudio.current !== element) return;
      setFailed(true); setPlaying(false); setWaiting(false); activeAudio.current = null;
    }
  };
  const time = duration === undefined ? t("admin.voices.durationLoading") : duration < 1 ? t("admin.voices.shortSample") : clock(duration);
  return <div className="voice-sample">
    <div className="voice-sample-line">
      {src ? <>
        <audio ref={audio} src={src} preload="metadata" hidden
          onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); }}
          onDurationChange={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); }}
          onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
          onPlay={event => { if (activeAudio.current !== event.currentTarget) event.currentTarget.pause(); else setPlaying(true); }}
          onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
          onPause={() => { setPlaying(false); setWaiting(false); }}
          onEnded={() => { setPlaying(false); setWaiting(false); setPosition(0); if (activeAudio.current === audio.current) activeAudio.current = null; }}
          onError={() => { setFailed(true); setPlaying(false); setWaiting(false); if (activeAudio.current === audio.current) activeAudio.current = null; }} />
        <button type="button" className="voice-play" disabled={busy && !playing && !waiting} onClick={() => void toggle()}
          aria-label={t(failed ? "admin.voices.retrySample" : playing || waiting ? "admin.voices.pauseSample" : "admin.voices.playSample", { name })} data-icon-motion="press">
          <span aria-hidden="true" data-icon-glyph>{failed ? "↻" : playing || waiting ? "Ⅱ" : "▶"}</span>
        </button>
        <span className={`voice-sample-time${failed ? " is-error" : ""}`} aria-live="off">{failed ? t("admin.voices.playbackFailed") : waiting ? t("common.loading") : playing ? `${clock(position)} / ${time}` : time}</span>
      </> : <span className="voice-sample-empty">{t("admin.voices.audioEmpty")}</span>}
      <input ref={input} type="file" hidden accept=".wav,.mp3,audio/wav,audio/mpeg" disabled={busy} onChange={onUpload} />
      <button type="button" className="voice-sample-upload" disabled={busy} onClick={() => input.current?.click()}>{t(src ? "admin.voices.replaceAudio" : "admin.voices.uploadAudio")}</button>
      {src && <div className="voice-sample-more" ref={menu}>
        <button type="button" ref={more} disabled={busy} aria-label={t("admin.voices.moreAudio", { name })} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)} data-icon-motion="pop"><span aria-hidden="true" data-icon-glyph>⋯</span></button>
        {open && <div className="voice-sample-menu" id={menuId}><button type="button" disabled={busy} onClick={() => { setOpen(false); more.current?.focus(); onRemove(); }}>{t("admin.voices.removeAudio")}</button></div>}
      </div>}
    </div>
    {failed && <span className="sr-only" role="status">{t("admin.voices.playbackFailedFor", { name })}</span>}
  </div>;
}
