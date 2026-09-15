import { ApiError } from "@lifewood/api-client";

// Small downloads retain the existing browser download flow.
export const streamingDeliveryThreshold = 50_000_000;
type SaveWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle> };

export async function chooseDeliveryTarget(fileName: string, sizeBytes: number): Promise<FileSystemFileHandle | undefined> {
  const picker = (window as SaveWindow).showSaveFilePicker;
  if (sizeBytes < streamingDeliveryThreshold || !window.isSecureContext || typeof picker !== "function") return undefined;
  try {
    // Called before any network request/await so the click's user activation is retained.
    return await picker.call(window, { suggestedName: fileName });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({code:"download.save_failed",messageKey:"delivery.saveFailed",retryable:true});
  }
}

export async function openDeliveryWriter(target: FileSystemFileHandle, signal: AbortSignal) {
  signal.throwIfAborted();
  let writer: FileSystemWritableFileStream;
  try { writer = await target.createWritable(); }
  catch {
    signal.throwIfAborted();
    throw new ApiError({code:"download.save_failed",messageKey:"delivery.saveFailed",retryable:true});
  }
  if (signal.aborted) {
    await writer.abort().catch(() => {});
    signal.throwIfAborted();
  }
  return writer;
}
