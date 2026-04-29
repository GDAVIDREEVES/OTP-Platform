export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

export interface ToastApi {
  show: (message: string, severity?: ToastSeverity) => void;
}
