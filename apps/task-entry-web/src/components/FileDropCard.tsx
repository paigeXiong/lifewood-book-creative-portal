import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ReferenceAsset, ReferenceCategory } from "@lifewood/domain";

type DisplayCategory = ReferenceCategory & { unavailable?: boolean };

function formatBytes(bytes: number, locale: string) {
  const divisor = bytes >= 1_000_000 ? 1_000_000 : 1_000;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / divisor);
}

export function FileDropCard({
  inputId,
  category,
  files,
  locale,
  busyCategory,
  required,
  preview,
  className,
  showFileList = true,
  camera = false,
  onUpload,
  onRemove,
}: {
  inputId: string;
  category: DisplayCategory;
  files: ReferenceAsset[];
  locale: string;
  busyCategory?: string;
  required?: boolean;
  preview?: ReactNode;
  className?: string;
  showFileList?: boolean;
  camera?: boolean;
  onUpload: (category: ReferenceCategory, files: FileList | null) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Requiredness is represented by the field marker, including for older catalog labels.
  const label = category.label.replace(/\s*[（(]\s*(?:可选|选填|必填|必选|必传|optional|required)\s*[）)]\s*$/i, "").replace(/^Optional\s+(\S)/i, (_, first: string) => first.toUpperCase());
  const cameraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const atLimit = files.length >= category.maxFiles;
  const disabled = Boolean(busyCategory) || Boolean(category.unavailable) || atLimit;
  const uploading = busyCategory === category.id;

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input")) return;
    openPicker();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPicker();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!disabled) setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length) void onUpload(category, event.dataTransfer.files);
  };

  const prompt = dragging
    ? t("uploadZone.dropActive")
    : uploading
      ? t("voice.uploading")
      : category.unavailable
        ? t("uploadZone.unavailable")
        : atLimit
          ? t("uploadZone.limitReached")
          : t("uploadZone.dropHint");

  return <div
    className={`upload-card upload-drop-card${className ? ` ${className}` : ""}${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}${files.length ? " has-files" : ""}`}
    onClick={handleClick}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
  >
    <div className="upload-card-heading">
      <div>
        <strong>{label}{required && <span className="required" aria-hidden="true">*</span>}</strong>
        <small>{category.description}</small>
      </div>
      <small>{t("voice.fileLimit", { size: formatBytes(category.maxBytes, locale), count: category.maxFiles })}</small>
    </div>
    {preview}
    <div className="upload-drop-prompt" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={t("sourceFiles.chooseFor", { category: label })} onKeyDown={handleKeyDown}>
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 16V5m0 0L8 9m4-4 4 4M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
      </svg>
      <span><b>{prompt}</b>{!disabled && !dragging && <small>{t("uploadZone.browseHint")}</small>}</span>
    </div>
    <input
      ref={inputRef}
      id={inputId}
      name={inputId}
      autoComplete="off"
      className="visually-hidden"
      type="file"
      aria-label={label}
      aria-required={required}
      multiple={category.maxFiles > 1}
      accept={category.accept.join(",")}
      disabled={disabled}
      onChange={(event) => {
        const input = event.currentTarget;
        void onUpload(category, input.files).finally(() => {
          input.value = "";
        });
      }}
    />
    {camera && <>
      <button className="button button-secondary upload-camera-button" type="button" disabled={disabled} onClick={() => cameraRef.current?.click()}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5 6 8H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2l-2-3H8Z" />
          <circle cx="12" cy="14" r="4" />
        </svg>
        <span>{t("bookIntake.takePhoto")}</span>
      </button>
      <input ref={cameraRef} type="file" hidden aria-label={t("bookIntake.takePhoto")} accept={category.accept.join(",")} capture="environment" disabled={disabled} onChange={event => { const input = event.currentTarget; void onUpload(category, input.files).finally(() => { input.value = ""; }); }} />
    </>}
    {showFileList && files.length > 0 && <ul className="uploaded-files">{files.map((asset) => <li key={asset.id}>
      <span title={asset.fileName}>{asset.fileName}</span>
      <small>{formatBytes(asset.sizeBytes, locale)}</small>
      <button type="button" aria-label={t("sourceFiles.removeFile", { fileName: asset.fileName })} disabled={Boolean(busyCategory)} onClick={() => void onRemove(asset.id)}>{t("voice.remove")}</button>
    </li>)}</ul>}
  </div>;
}
