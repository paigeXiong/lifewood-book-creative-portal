import { useEffect, useState } from "react";

const toastEvent = "lifewood:admin-toast";

export function showAdminToast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(toastEvent, { detail: message }));
}

export function ToastHost() {
  const [toast, setToast] = useState<{ id: number; message: string }>();

  useEffect(() => {
    const show = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      setToast({ id: Date.now(), message });
    };
    window.addEventListener(toastEvent, show);
    return () => window.removeEventListener(toastEvent, show);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
    {toast && <div key={toast.id} className="admin-toast">{toast.message}</div>}
  </div>;
}
