import { FileTransfers, type FileTransfer } from "./FileTransfers";
import { createId } from "../create-id";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ReferenceAsset, ReferenceCategory } from "@lifewood/domain";
import { PhotoError, preparePhoto } from "../prepare-photo";
import { interruptedPhotoAttempt, markPhotoAttempt } from "../photo-attempt";

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
  feedback,
  selectionBlocked = false,
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
  feedback?: ReactNode;
  selectionBlocked?: boolean;
  onUpload: (category: ReferenceCategory, files: FileList | readonly File[] | null) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Requiredness is represented by the field marker, including for older catalog labels.
  const label = category.label.replace(/\s*[（(]\s*(?:可选|选填|必填|必选|必传|optional|required)\s*[）)]\s*$/i, "").replace(/^Optional\s+(\S)/i, (_, first: string) => first.toUpperCase());
  const cameraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const [failedPhotos, setFailedPhotos] = useState<FileTransfer[]>([]);
  const preparationEpoch = useRef(0);
  useEffect(() => {
    preparationEpoch.current += 1;
    setFailedPhotos([]); setPreparingPhoto(false); setPhotoError(undefined);
    return () => { preparationEpoch.current += 1; };
  }, [inputId]);
  const [interrupted, setInterrupted] = useState(() => camera ? interruptedPhotoAttempt(inputId) : undefined);
  useEffect(() => {
    const input = cameraRef.current;
    const cancel = () => markPhotoAttempt(inputId);
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, [inputId, camera]);
  const atLimit = files.length >= category.maxFiles;
  const disabled = selectionBlocked || preparingPhoto || Boolean(busyCategory) || Boolean(category.unavailable) || atLimit;
  const uploading = busyCategory === category.id;
  const uploadFiles = async (selectedFiles: FileList | readonly File[] | null) => {
    if (!selectedFiles?.length) { if (camera) markPhotoAttempt(inputId); return; }
    if (!camera) { await onUpload(category, selectedFiles); return; }
    const epoch = preparationEpoch.current;
    setPhotoError(undefined);
    setInterrupted(undefined);
    markPhotoAttempt(inputId, "processing");
    setPreparingPhoto(true);
    try {
      const prepared: File[] = [];
      for (const file of Array.from(selectedFiles).slice(0, Math.max(0, category.maxFiles - files.length))) {
        try {
          prepared.push(await preparePhoto(file, category));
        } catch (error) {
          if (epoch !== preparationEpoch.current) return;
          setFailedPhotos(items => [...items, { id: createId(), categoryId: category.id, file, status: "error", error: t(`bookIntake.${error instanceof PhotoError ? error.key : "photoUploadFailed"}`) }]);
        }
        if (epoch !== preparationEpoch.current) return;
      }
      setPreparingPhoto(false);
      markPhotoAttempt(inputId, "uploading");
      if (prepared.length && epoch === preparationEpoch.current) await onUpload(category, prepared);
    }
    catch (error) { if (epoch === preparationEpoch.current) setPhotoError(t(`bookIntake.${error instanceof PhotoError ? error.key : "photoUploadFailed"}`)); }
    finally { if (epoch === preparationEpoch.current) { markPhotoAttempt(inputId); setPreparingPhoto(false); } }
  };

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
    if (!disabled && event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files);
  };

  const prompt = dragging
    ? t("uploadZone.dropActive")
    : preparingPhoto
      ? t("bookIntake.preparingPhoto")
    : uploading
      ? t("voice.uploading")
      : selectionBlocked
        ? t("fileTransfer.resolveFirst")
      : category.unavailable
        ? t("uploadZone.unavailable")
        : atLimit
          ? t("uploadZone.limitReached")
          : <><span className="upload-hint-touch">{t("uploadZone.tapHint")}</span><span className="upload-hint-desktop">{t("uploadZone.dropHint")}</span></>;

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
      tabIndex={-1}
      aria-label={label}
      aria-required={required}
      multiple={category.maxFiles > 1}
      accept={category.accept.join(",")}
      disabled={disabled}
      onChange={(event) => {
        const input = event.currentTarget;
        void uploadFiles(input.files).finally(() => {
          input.value = "";
        });
      }}
    />
    {camera && <>
      <button className="button button-secondary upload-camera-button" type="button" disabled={disabled} onClick={() => { markPhotoAttempt(inputId, "camera"); cameraRef.current?.click(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5 6 8H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2l-2-3H8Z" />
          <circle cx="12" cy="14" r="4" />
        </svg>
        <span>{t(preparingPhoto ? "bookIntake.preparingPhoto" : "bookIntake.takePhoto")}</span>
      </button>
      <input ref={cameraRef} type="file" hidden aria-label={t("bookIntake.takePhoto")} accept="image/*" capture="environment" disabled={disabled} onChange={event => {
        const input = event.currentTarget;
        void uploadFiles(input.files).finally(() => { input.value = ""; });
      }} />
      {photoError && <div className="inline-error" role="alert">{photoError}</div>}
      {interrupted && <div className="inline-error" role="alert">{t(`bookIntake.photoInterrupted_${interrupted}`)}</div>}
    </>}
    {showFileList && files.length > 0 && <ul className="uploaded-files">{files.map((asset) => <li key={asset.id}>
      <span title={asset.fileName}>{asset.fileName}</span>
      <small>{formatBytes(asset.sizeBytes, locale)}</small>
      <button type="button" aria-label={t("sourceFiles.removeFile", { fileName: asset.fileName })} disabled={Boolean(busyCategory) || selectionBlocked} onClick={() => void onRemove(asset.id)}>{t("voice.remove")}</button>
    </li>)}</ul>}
    <FileTransfers items={failedPhotos} busy={disabled}
      onCancel={id => setFailedPhotos(items => items.filter(item => item.id !== id))}
      onRetry={async item => { setFailedPhotos(items => items.filter(entry => entry.id !== item.id)); await uploadFiles([item.file]); }} />
    {feedback}
  </div>;
}
