export type ToastKind = "success" | "error" | "info";

export interface ToastRequest {
  message: string;
  kind?: ToastKind;
  actionLabel?: string;
  action?: () => void | Promise<void>;
  durationMs?: number;
}

const EVENT_NAME = "fyj:toast";

export function showToast(request: string | ToastRequest) {
  const detail: ToastRequest = typeof request === "string" ? { message: request } : request;
  window.dispatchEvent(new CustomEvent<ToastRequest>(EVENT_NAME, { detail }));
}

export function onToast(listener: (request: ToastRequest) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<ToastRequest>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
