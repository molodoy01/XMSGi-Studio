import { createContext, useCallback, useContext } from 'react';

export type ConfirmDialogOptions = {
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
};

export type ConfirmAction = (options: ConfirmDialogOptions) => Promise<boolean>;

export const ConfirmDialogContext = createContext<ConfirmAction | null>(null);

export function useConfirm() {
  const confirmAction = useContext(ConfirmDialogContext);
  return useCallback((options: ConfirmDialogOptions) => {
    if (confirmAction) return confirmAction(options);
    return Promise.resolve(window.confirm(options.message));
  }, [confirmAction]);
}