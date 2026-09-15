import { useEffect, useRef, useState } from "react";
import { ApiError, captureAccountGuard } from "@lifewood/api-client";

export function saveExport(blob: Blob, fileName: string) {
  let url: string | undefined;
  const link = document.createElement("a");
  try {
    url = URL.createObjectURL(blob);
    link.href = url; link.download = fileName;
    document.body.append(link); link.click();
  } catch {
    if (url) URL.revokeObjectURL(url);
    throw new ApiError({ code: "download.save", messageKey: "admin.download.failed", retryable: true });
  } finally { link.remove(); }
  // Allow the browser to start consuming the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url!), 30_000);
}

export function useExportDownload(scope: string) {
  const [pending, setPending] = useState(false), [error, setError] = useState<unknown>();
  const active = useRef<AbortController | null>(null), lifetime = useRef<object | null>(null);
  useEffect(() => {
    const current = {}; lifetime.current = current;
    setPending(false); setError(undefined);
    return () => { lifetime.current = null; active.current?.abort(); active.current = null; };
  }, [scope]);
  const cancel = () => {
    active.current?.abort(); active.current = null;
    setPending(false); setError(undefined);
  };
  const run = async (request: (signal: AbortSignal) => Promise<Blob>, fileName: string) => {
    if (active.current || !lifetime.current) return;
    const current = lifetime.current, controller = new AbortController();
    active.current = controller; setPending(true); setError(undefined);
    const valid = () => lifetime.current === current && active.current === controller && !controller.signal.aborted;
    try {
      const account = captureAccountGuard(); account();
      const blob = await request(controller.signal);
      if (!valid()) return;
      account(); saveExport(blob, fileName);
    } catch (cause) { if (valid()) setError(cause); }
    finally { if (valid()) { active.current = null; setPending(false); } }
  };
  return { pending, error, cancel, run, clearError: () => setError(undefined) };
}
