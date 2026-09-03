import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConfigOption } from "@lifewood/domain";
import { FieldIcon } from "./FieldIcon";

function HoverVideo({ url, poster, label, onError }: { url: string; poster?: string; label: string; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hovering = useRef(false);
  const [controls, setControls] = useState(false);
  const pause = () => { hovering.current = false; videoRef.current?.pause(); };
  useEffect(() => {
    const video = videoRef.current;
    const onVisibility = () => { if (document.hidden) { hovering.current = false; video?.pause(); } };
    document.addEventListener("visibilitychange", onVisibility);
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) { hovering.current = false; video?.pause(); }
    });
    if (video) observer?.observe(video);
    return () => { hovering.current = false; video?.pause(); observer?.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  return <video ref={videoRef} src={url} poster={poster} width={960} height={540}
    muted loop playsInline preload="metadata" controls={controls} tabIndex={0} aria-label={label}
    onPointerEnter={event => {
      if (event.pointerType === "touch") return;
      hovering.current = true;
      const video = event.currentTarget;
      video.muted = true;
      void video.play().then(() => { if (!hovering.current) video.pause(); }).catch(() => {});
    }}
    onPointerLeave={pause}
    onPointerDown={event => { if (event.pointerType === "touch") setControls(true); }}
    onFocus={() => setControls(true)} onBlur={pause} onError={onError}
  />;
}

export function StylePreviewImage({ option, className }: { option?: ConfigOption; className: string }) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [failedVideoUrl, setFailedVideoUrl] = useState<string>();
  const url = option?.previewImageUrl;
  const videoUrl = option?.previewVideoUrl;
  return <span className={className}>
    {videoUrl && videoUrl !== failedVideoUrl ? <HoverVideo key={videoUrl} url={videoUrl} poster={url}
      label={t("creative.stylePreview.videoAlt", { style: option?.label ?? "" })} onError={() => setFailedVideoUrl(videoUrl)} /> : url && url !== failedUrl ? <img
      src={url}
      alt={t("creative.stylePreview.alt", { style: option?.label ?? "" })}
      width={960}
      height={540}
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(url)}
    /> : <span className="style-preview-empty">
      <FieldIcon name="image" />
      <span>{t(option ? "creative.stylePreview.unavailable" : "creative.summary.noStyle")}</span>
    </span>}
  </span>;
}
