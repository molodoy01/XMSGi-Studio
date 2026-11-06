import { useCallback, useEffect, useId, useRef, useState, type PropsWithChildren } from 'react';
import { ConfirmDialogContext, type ConfirmAction, type ConfirmDialogOptions } from './useConfirm';
import './ConfirmDialog.css';

type ConfirmRequest = ConfirmDialogOptions & {
  id: number;
  resolve: (confirmed: boolean) => void;
};

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const [activeRequest, setActiveRequest] = useState<ConfirmRequest | null>(null);
  const requestsRef = useRef<ConfirmRequest[]>([]);
  const nextIdRef = useRef(0);

  const confirmAction = useCallback<ConfirmAction>((options) => new Promise((resolve) => {
    const request = { ...options, id: ++nextIdRef.current, resolve };
    requestsRef.current = [...requestsRef.current, request];
    if (requestsRef.current.length === 1) setActiveRequest(request);
  }), []);

  const settleActiveRequest = useCallback((confirmed: boolean) => {
    const [current, ...remaining] = requestsRef.current;
    if (!current) return;
    requestsRef.current = remaining;
    current.resolve(confirmed);
    setActiveRequest(remaining[0] ?? null);
  }, []);

  useEffect(() => () => {
    requestsRef.current.forEach((request) => request.resolve(false));
    requestsRef.current = [];
  }, []);

  return (
    <ConfirmDialogContext.Provider value={confirmAction}>
      {children}
      {activeRequest && (
        <ConfirmDialogSurface
          title={activeRequest.title}
          message={activeRequest.message}
          confirmLabel={activeRequest.confirmLabel}
          cancelLabel={activeRequest.cancelLabel}
          destructive={activeRequest.destructive}
          onCancel={() => settleActiveRequest(false)}
          onConfirm={() => settleActiveRequest(true)}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function ConfirmDialogSurface({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        if (event.target instanceof HTMLElement && event.target.closest('.confirm-dialog-cancel')) return;
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title || message}</h2>
        {title && <p>{message}</p>}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className={`confirm-dialog-confirm${destructive ? ' is-destructive' : ''}`}
            onClick={onConfirm}
            autoFocus={destructive}
          >
            {confirmLabel}
          </button>
          <button type="button" className="confirm-dialog-cancel" onClick={onCancel} autoFocus={!destructive}>
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );
}