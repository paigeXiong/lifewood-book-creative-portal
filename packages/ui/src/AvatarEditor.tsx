import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const VIEWPORT_SIZE = 240;
const OUTPUT_SIZE = 512;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_SOURCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type AvatarEditorLabels = {
  title: string;
  close: string;
  choose: string;
  chooseAnother: string;
  instruction: string;
  zoom: string;
  cancel: string;
  save: string;
  saving: string;
  remove: string;
  invalidImage: string;
};

type LoadedImage = { element: HTMLImageElement; url: string };
type ImageDimensions = { width: number; height: number };

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function parseAvatarImageDimensions(buffer: ArrayBuffer, mediaType: string): ImageDimensions | undefined {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (mediaType === "image/png") {
    if (bytes.length < 24 || !bytesEqual(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) || !bytesEqual(bytes, 12, [73, 72, 68, 82])) return undefined;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mediaType === "image/jpeg") {
    if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0x01) continue;
      if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) return undefined;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if (startOfFrame.has(marker)) {
        if (length < 7) return undefined;
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
    return undefined;
  }
  if (mediaType === "image/webp") {
    if (bytes.length < 25 || !bytesEqual(bytes, 0, [82, 73, 70, 70]) || !bytesEqual(bytes, 8, [87, 69, 66, 80])) return undefined;
    if (bytesEqual(bytes, 12, [86, 80, 56, 88]) && bytes.length >= 30) {
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (bytesEqual(bytes, 12, [86, 80, 56, 76]) && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (bytesEqual(bytes, 12, [86, 80, 56, 32]) && bytes.length >= 30 && bytesEqual(bytes, 23, [0x9d, 0x01, 0x2a])) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
  }
  return undefined;
}

function sourceMediaType(file: File): string | undefined {
  const mediaType = file.type.toLowerCase();
  if (SUPPORTED_SOURCE_TYPES.has(mediaType)) return mediaType;
  if (!mediaType && /\.png$/i.test(file.name)) return "image/png";
  if (!mediaType && /\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (!mediaType && /\.webp$/i.test(file.name)) return "image/webp";
  return undefined;
}

export function avatarImageDimensionsAreSafe(dimensions: ImageDimensions | undefined): dimensions is ImageDimensions {
  return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0 && dimensions.width <= 8192 && dimensions.height <= 8192 && dimensions.width * dimensions.height <= 16_000_000);
}

export function clampAvatarOffset(value: number, renderedSize: number): number {
  const limit = Math.max(0, (renderedSize - VIEWPORT_SIZE) / 2);
  return Math.max(-limit, Math.min(limit, value));
}

export function AvatarEditor({
  avatarUrl,
  displayName,
  hasCustomAvatar,
  labels,
  busy,
  error,
  onClose,
  onSave,
  onRemove,
  returnFocus,
}: {
  avatarUrl: string;
  displayName: string;
  hasCustomAvatar: boolean;
  labels: AvatarEditorLabels;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (file: File) => void;
  onRemove: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);
  const offsetRef = useRef({ x: 0, y: 0 });
  const busyRef = useRef(busy);
  const preparingRef = useRef(false);
  const closeRef = useRef(onClose);
  const selectionRef = useRef(0);
  const pendingUrlRef = useRef<string | undefined>(undefined);
  const [image, setImage] = useState<LoadedImage>();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [localError, setLocalError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  busyRef.current = busy;
  preparingRef.current = preparing;
  closeRef.current = onClose;

  const baseScale = image ? Math.max(VIEWPORT_SIZE / image.element.naturalWidth, VIEWPORT_SIZE / image.element.naturalHeight) : 1;
  const renderedWidth = image ? image.element.naturalWidth * baseScale * zoom : VIEWPORT_SIZE;
  const renderedHeight = image ? image.element.naturalHeight * baseScale * zoom : VIEWPORT_SIZE;

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => () => {
    selectionRef.current += 1;
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current);
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const first = dialog?.querySelector<HTMLElement>(focusableSelector);
    (first ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current && !preparingRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => !item.hasAttribute("disabled"));
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocus?.isConnected ? returnFocus : previousFocus)?.focus();
    };
  }, [returnFocus]);

  const chooseImage = async (file?: File) => {
    if (!file) return;
    const selection = ++selectionRef.current;
    if (pendingUrlRef.current) { URL.revokeObjectURL(pendingUrlRef.current); pendingUrlRef.current = undefined; }
    const mediaType = sourceMediaType(file);
    if (!mediaType || file.size > MAX_SOURCE_BYTES) { setLocalError(labels.invalidImage); return; }
    let dimensions: ImageDimensions | undefined;
    try { dimensions = parseAvatarImageDimensions(await file.arrayBuffer(), mediaType); }
    catch { if (selection === selectionRef.current) setLocalError(labels.invalidImage); return; }
    if (selection !== selectionRef.current) return;
    if (!avatarImageDimensionsAreSafe(dimensions)) { setLocalError(labels.invalidImage); return; }
    const url = URL.createObjectURL(file);
    pendingUrlRef.current = url;
    const element = new Image();
    element.onload = () => {
      if (selection !== selectionRef.current || pendingUrlRef.current !== url) { URL.revokeObjectURL(url); return; }
      pendingUrlRef.current = undefined;
      const dimensionsMatch = (element.naturalWidth === dimensions.width && element.naturalHeight === dimensions.height) ||
        (element.naturalWidth === dimensions.height && element.naturalHeight === dimensions.width);
      if (!dimensionsMatch) {
        URL.revokeObjectURL(url);
        setLocalError(labels.invalidImage);
        return;
      }
      setImage((previous) => { if (previous) URL.revokeObjectURL(previous.url); return { element, url }; });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      offsetRef.current = { x: 0, y: 0 };
      setLocalError(undefined);
    };
    element.onerror = () => {
      if (pendingUrlRef.current === url) pendingUrlRef.current = undefined;
      URL.revokeObjectURL(url);
      if (selection === selectionRef.current) setLocalError(labels.invalidImage);
    };
    element.src = url;
  };

  const updateZoom = (nextZoom: number) => {
    if (!image) return;
    const nextWidth = image.element.naturalWidth * baseScale * nextZoom;
    const nextHeight = image.element.naturalHeight * baseScale * nextZoom;
    setZoom(nextZoom);
    const nextOffset = { x: clampAvatarOffset(offsetRef.current.x, nextWidth), y: clampAvatarOffset(offsetRef.current.y, nextHeight) };
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!image || busy || preparing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const nextOffset = {
      x: clampAvatarOffset(start.offsetX + event.clientX - start.x, renderedWidth),
      y: clampAvatarOffset(start.offsetY + event.clientY - start.y, renderedHeight),
    };
    offsetRef.current = nextOffset;
    if (cropImageRef.current) cropImageRef.current.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;
  };
  const endDrag = () => { dragRef.current = undefined; setOffset(offsetRef.current); };
  const moveWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!image || busy || preparing || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    const nextOffset = {
      x: clampAvatarOffset(offsetRef.current.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), renderedWidth),
      y: clampAvatarOffset(offsetRef.current.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0), renderedHeight),
    };
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  };

  const save = () => {
    if (!image) return;
    setPreparing(true);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) { setPreparing(false); setLocalError(labels.invalidImage); return; }
    const ratio = OUTPUT_SIZE / VIEWPORT_SIZE;
    try {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image.element,
        (offsetRef.current.x - renderedWidth / 2 + VIEWPORT_SIZE / 2) * ratio,
        (offsetRef.current.y - renderedHeight / 2 + VIEWPORT_SIZE / 2) * ratio,
        renderedWidth * ratio,
        renderedHeight * ratio,
      );
      canvas.toBlob((blob) => {
        setPreparing(false);
        if (!blob) { setLocalError(labels.invalidImage); return; }
        onSave(new File([blob], "avatar.png", { type: "image/png", lastModified: Date.now() }));
      }, "image/png");
    } catch {
      setPreparing(false);
      setLocalError(labels.invalidImage);
    }
  };

  return (
    <div className="avatar-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !preparing) onClose(); }}>
      <div ref={dialogRef} className="avatar-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="avatar-editor-header">
          <h2 id={titleId}>{labels.title}</h2>
          <button type="button" className="avatar-editor-close" aria-label={labels.close} disabled={busy || preparing} onClick={onClose}>×</button>
        </header>
        <div className="avatar-editor-body">
          {image ? (
            <>
              <div className="avatar-crop-stage" role="application" aria-label={labels.instruction} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown" tabIndex={0} onKeyDown={moveWithKeyboard} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <img ref={cropImageRef} src={image.url} alt="" width={Math.round(renderedWidth)} height={Math.round(renderedHeight)} draggable={false} style={{ width: renderedWidth, height: renderedHeight, transform: `translate(${offset.x}px, ${offset.y}px)` }} />
                <span className="avatar-crop-mask" aria-hidden="true" />
              </div>
              <p className="avatar-editor-instruction">{labels.instruction}</p>
              <label className="avatar-zoom-control">
                <span>{labels.zoom}</span>
                <input type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy || preparing} onChange={(event) => updateZoom(Number(event.target.value))} />
              </label>
            </>
          ) : (
            <img className="avatar-editor-current" src={avatarUrl} alt={displayName} width="144" height="144" />
          )}
          <input ref={fileInputRef} className="avatar-editor-file" name="avatarSource" aria-label={labels.choose} type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} onChange={(event) => { void chooseImage(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <button type="button" className="avatar-editor-choose" disabled={busy || preparing} onClick={() => fileInputRef.current?.click()}>{image ? labels.chooseAnother : labels.choose}</button>
          {(localError || error) ? <p className="avatar-editor-error" role="alert">{localError || error}</p> : null}
        </div>
        <footer className="avatar-editor-actions">
          {hasCustomAvatar && !image ? <button type="button" className="avatar-editor-remove" disabled={busy || preparing} onClick={onRemove}>{labels.remove}</button> : <span />}
          <div>
            <button type="button" disabled={busy || preparing} onClick={onClose}>{labels.cancel}</button>
            {image ? <button type="button" className="avatar-editor-save" disabled={busy || preparing} onClick={save}>{busy || preparing ? labels.saving : labels.save}</button> : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
