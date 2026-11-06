import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { DraftColorPicker } from './DraftColorPicker';
import { useLocale } from '@studio/lib/i18n';
import {
  clearGlassPointer,
  clearIconRimPointer,
  updateGlassPointer,
  updateIconRimPointer,
} from '../lib/workspacePointerEffects';
import type { DraftColor } from '../types';
import type { StudioInlineNotification } from '../pages/workspacePageTypes';

export type PublishAction = 'send' | 'schedule' | 'draft';
export type WorkspaceStageMode = 'editor' | 'schedule' | 'template' | 'draft' | 'chat';
export type PublishFooterStatus = {
  message: string;
  detail?: string;
  kind: 'error' | 'progress' | 'warning' | 'success' | 'notice';
  transient: boolean;
  duration: number | null;
};

type WorkspacePageActionRowsProps = {
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  albumFileInputRef: MutableRefObject<HTMLInputElement | null>;
  onFileSelection: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAlbumFileSelection: (event: React.ChangeEvent<HTMLInputElement>) => void;
  previewVisible: boolean;
  onTogglePreview: (event: React.MouseEvent<HTMLButtonElement>) => void;
  stageMode: WorkspaceStageMode;
  setStageMode: Dispatch<SetStateAction<WorkspaceStageMode>>;
  changeStageMode: (mode: WorkspaceStageMode) => void;
  closeTemplateEditor: () => void;
  publishAction: PublishAction;
  scheduleFocus: 'repeat' | 'time' | null;
  openScheduleStage: (focus: 'repeat' | 'time' | null) => void;
  publishMenuOpen: boolean;
  setPublishMenuOpen: Dispatch<SetStateAction<boolean>>;
  publishMenuRef: MutableRefObject<HTMLDivElement | null>;
  publishMenuToggleRef: MutableRefObject<HTMLButtonElement | null>;
  onPrimaryPublish: () => void;
  onChoosePublishAction: (action: PublishAction) => void;
  sendInFlight: boolean;
  savingCurrentDraft: boolean;
  publishingDraft: boolean;
  scheduling: boolean;
  successPulse: boolean;
  lastAction: 'sent' | 'scheduled' | null;
  reconnectingForSend: boolean;
  publishFooterStatus: PublishFooterStatus | null;
  publishScheduleSummary: string;
  draftColor: DraftColor;
  setDraftColor: Dispatch<SetStateAction<DraftColor>>;
  inlineNotification: StudioInlineNotification | null;
  publishFeedbackInstance: number;
  retriggeredPublishFeedback: { message: string; kind: string } | null;
  connectionRecoveryStatus?: 'reconnecting' | 'offline' | null;
  sendError: string;
  onRetrySend: () => void;
  previewHistoryError: string;
  previewHistoryErrorRetryable: boolean;
  previewHistoryLoading: boolean;
  onRetryPreviewHistory: () => void;
  draftStoreError: string;
  draftStoreBackups: number[];
  onRestoreDraftBackup: (index: number) => void;
};

export function WorkspacePageActionRows({
  fileInputRef,
  albumFileInputRef,
  onFileSelection,
  onAlbumFileSelection,
  previewVisible,
  onTogglePreview,
  stageMode,
  setStageMode,
  changeStageMode,
  closeTemplateEditor,
  publishAction,
  scheduleFocus,
  openScheduleStage,
  publishMenuOpen,
  setPublishMenuOpen,
  publishMenuRef,
  publishMenuToggleRef,
  onPrimaryPublish,
  onChoosePublishAction,
  sendInFlight,
  savingCurrentDraft,
  publishingDraft,
  scheduling,
  successPulse,
  lastAction,
  reconnectingForSend,
  publishFooterStatus,
  publishScheduleSummary,
  draftColor,
  setDraftColor,
  inlineNotification,
  publishFeedbackInstance,
  retriggeredPublishFeedback,
  connectionRecoveryStatus = null,
  sendError,
  onRetrySend,
  previewHistoryError,
  previewHistoryErrorRetryable,
  previewHistoryLoading,
  onRetryPreviewHistory,
  draftStoreError,
  draftStoreBackups,
  onRestoreDraftBackup,
}: WorkspacePageActionRowsProps) {
  const { locale, t } = useLocale();

  return (
    <>
      <div className={`workspace-page-action-row workspace-page-schedule-row ${publishMenuOpen ? 'is-publish-menu-open' : ''}`}>
        <div className="workspace-page-media-row">
          <button
            type="button"
            className="workspace-page-preview-toggle workspace-page-attachment-toggle"
            onClick={() => fileInputRef.current?.click()}
            onPointerMove={updateIconRimPointer}
            onPointerLeave={clearIconRimPointer}
            aria-label={t('studio.addFile')}
            title={t('studio.addAttachment')}
          >
            <svg className="workspace-page-attachment-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="workspace-attachment-metal" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#f5fbff" />
                  <stop offset="0.38" stopColor="#c2d8e5" />
                  <stop offset="0.72" stopColor="#819aaa" />
                  <stop offset="1" stopColor="#e0edf4" />
                </linearGradient>
              </defs>
              <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" transform="translate(0 0.65)" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" fill="none" stroke="url(#workspace-attachment-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9.6 12.4 16.7 5.3a3.7 3.7 0 1 1 5.2 5.2l-9.4 9.4a5.9 5.9 0 1 1-8.4-8.4l9.9-9.9" transform="translate(-0.12 -0.18)" fill="none" stroke="rgba(250, 253, 255, 0.48)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={onFileSelection} className="workspace-page-hidden-file-input" />
          <input
            ref={albumFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.jfif,.png,.webp"
            multiple
            onChange={onAlbumFileSelection}
            className="workspace-page-hidden-file-input"
          />
        </div>
        <div className="workspace-page-action-left-group">
          <button
            type="button"
            className="workspace-page-preview-toggle"
            onClick={onTogglePreview}
            onPointerMove={updateIconRimPointer}
            onPointerLeave={clearIconRimPointer}
            aria-label={t(previewVisible ? 'studio.hidePreview' : 'studio.showPreview')}
            title={t(previewVisible ? 'studio.hidePreview' : 'studio.showPreview')}
            aria-pressed={previewVisible}
          >
            {previewVisible ? <VisiblePreviewIcon /> : <HiddenPreviewIcon />}
          </button>
          <button
            type="button"
            className={`workspace-page-mode-button workspace-page-mode-button-template ${stageMode === 'template' ? 'is-active' : ''}`}
            onClick={() => {
              if (stageMode === 'template') {
                closeTemplateEditor();
                setStageMode('editor');
              } else {
                changeStageMode('template');
              }
            }}
            aria-pressed={stageMode === 'template'}
            title={t('studio.manageTemplates')}
          >
            {t('studio.templates')}
          </button>
          {publishAction !== 'schedule' && stageMode !== 'schedule' && (
            <button
              type="button"
              className={`workspace-page-mode-button workspace-page-mode-button-template workspace-page-mode-button-draft ${stageMode === 'draft' ? 'is-active' : ''}`}
              onClick={() => stageMode === 'draft' ? changeStageMode('editor') : changeStageMode('draft')}
              aria-pressed={stageMode === 'draft'}
              title={t('studio.openDrafts')}
            >
              {t('studio.draftModeButton')}
            </button>
          )}
          {(publishAction === 'schedule' || stageMode === 'schedule') && (
            <div className="workspace-page-schedule-compact-group" aria-label={t('studio.scheduleTools')}>
              <button
                type="button"
                className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'time' ? 'is-active' : ''}`}
                onClick={() => openScheduleStage('time')}
                aria-pressed={stageMode === 'schedule' && scheduleFocus === 'time'}
                title={t('studio.setDateTime')}
              >
                {t('studio.time')}
              </button>
              <button
                type="button"
                className={`workspace-page-mode-button workspace-page-schedule-compact-button ${stageMode === 'schedule' && scheduleFocus === 'repeat' ? 'is-active' : ''}`}
                onClick={() => openScheduleStage('repeat')}
                aria-pressed={stageMode === 'schedule' && scheduleFocus === 'repeat'}
                title={t('studio.configureRepeat')}
              >
                {t('studio.repeat')}
              </button>
            </div>
          )}
        </div>
        <div className="workspace-page-submit-actions" ref={publishMenuRef}>
          <button
            type="button"
            className={`workspace-page-action-button workspace-page-publish-trigger workspace-page-publish-main ${publishAction === 'schedule' ? 'is-scheduled' : publishAction === 'draft' ? 'is-draft' : 'is-send'} ${successPulse && lastAction === 'sent' ? 'is-active' : ''}`}
            onClick={onPrimaryPublish}
            onPointerMove={updateIconRimPointer}
            onPointerLeave={clearIconRimPointer}
            disabled={sendInFlight || savingCurrentDraft || publishingDraft || scheduling}
          >
            <span className={`workspace-page-publish-trigger-main ${locale === 'en' ? 'is-english' : ''}`}>
              {publishAction === 'schedule'
                ? (scheduling ? t('studio.scheduling') : successPulse && lastAction === 'scheduled' ? t('studio.scheduled') : t('studio.schedule'))
                : publishAction === 'draft'
                  ? (savingCurrentDraft ? t('studio.saving') : t('studio.saveAction'))
                  : (publishingDraft ? t(reconnectingForSend ? 'studio.reconnecting' : 'studio.sending') : successPulse && lastAction === 'sent' ? t('studio.sent') : t('studio.sendAction'))}
            </span>
          </button>
          <button
            type="button"
            className={`workspace-page-publish-trigger workspace-page-publish-menu-toggle ${publishMenuOpen ? 'is-active' : ''}`}
            ref={publishMenuToggleRef}
            onClick={() => setPublishMenuOpen((current) => !current)}
            aria-label={t('studio.morePublishOptions')}
            title={t('studio.choosePublishAction')}
            aria-expanded={publishMenuOpen}
            aria-haspopup="menu"
            aria-pressed={publishMenuOpen}
            onPointerMove={updateIconRimPointer}
            onPointerLeave={clearIconRimPointer}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPublishMenuOpen(true);
              }
            }}
          >
            <span className="workspace-page-publish-trigger-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                <defs>
                  <linearGradient id="workspace-menu-metal" x1="6" y1="8" x2="18" y2="16" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#f5fbff" />
                    <stop offset="0.4" stopColor="#c2d8e5" />
                    <stop offset="0.72" stopColor="#819aaa" />
                    <stop offset="1" stopColor="#e0edf4" />
                  </linearGradient>
                </defs>
                <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 8.8 12 15l6-6.2" fill="none" stroke="url(#workspace-menu-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.4 8.4 12 14.2l5.6-5.8" fill="none" stroke="rgba(250, 253, 255, 0.5)" strokeWidth="0.65" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          {publishMenuOpen && (
            <div className="workspace-page-publish-menu workspace-page-publish-menu-compact" role="menu" aria-label={t('studio.publishAction')}>
              <PublishOption action="send" selected={publishAction} onChoose={onChoosePublishAction}>
                {t('studio.sendNow')}
              </PublishOption>
              <PublishOption action="schedule" selected={publishAction} onChoose={onChoosePublishAction}>
                {scheduling ? t('studio.scheduling') : successPulse && lastAction === 'scheduled' ? t('studio.scheduled') : t('studio.schedule')}
              </PublishOption>
              <PublishOption action="draft" selected={publishAction} onChoose={onChoosePublishAction}>
                {t('studio.draftMenuOption')}
              </PublishOption>
            </div>
          )}
        </div>
      </div>
      <div className={`workspace-page-action-row workspace-page-draft-footer${publishFooterStatus?.kind === 'warning' && publishFooterStatus.message === t('schedule.massWarningTitle') ? ' has-mass-warning' : ''}`}>
        <div className={`workspace-page-schedule-summary ${publishAction === 'draft' ? 'has-draft-color-picker' : ''}`}>
          <div
            className={`workspace-page-publish-footer-content${publishFooterStatus ? ' is-feedback-hidden' : ''}`}
            aria-hidden={Boolean(publishFooterStatus)}
          >
            {publishAction === 'schedule'
              ? publishScheduleSummary
              : publishAction === 'draft'
                ? <DraftColorPicker color={draftColor} onChange={setDraftColor} ariaLabel={t('studio.colorNewDraft')} />
                : ''}
          </div>
        </div>
        {publishFooterStatus && (
          <div
            key={`${inlineNotification?.revision ?? publishFeedbackInstance}-${publishFooterStatus.kind}-${publishFooterStatus.message}`}
            className={`workspace-page-publish-transient-feedback is-${publishFooterStatus.kind}${publishFooterStatus.transient ? ' is-notice' : ''}${publishFooterStatus.kind === 'warning' && publishFooterStatus.message === t('schedule.massWarningTitle') ? ' is-mass-warning' : ''}${retriggeredPublishFeedback?.message === publishFooterStatus.message && retriggeredPublishFeedback.kind === publishFooterStatus.kind ? ' is-retriggered' : ''}${connectionRecoveryStatus === 'reconnecting' && publishFooterStatus.message === t('telegramStatus.networkMessage') ? ' is-connection-recovering' : ''}${connectionRecoveryStatus === 'offline' && publishFooterStatus.message === t('telegramStatus.offlineMessage') ? ' is-connection-offline' : ''}`}
            style={publishFooterStatus.duration === null ? undefined : { '--status-duration': `${publishFooterStatus.duration}ms` } as React.CSSProperties}
            role={publishFooterStatus.kind === 'error' ? 'alert' : 'status'}
            aria-live={publishFooterStatus.kind === 'error' ? 'assertive' : 'polite'}
          >
            <span className="workspace-page-publish-transient-feedback-status" title={publishFooterStatus.message} aria-label={publishFooterStatus.message}>
              {connectionRecoveryStatus === 'reconnecting' && publishFooterStatus.message === t('telegramStatus.networkMessage') && (
                <span className="workspace-page-connection-spinner" aria-hidden="true" />
              )}
              {publishFooterStatus.message}
            </span>
            {sendError && publishFooterStatus.message === sendError && (
              <button type="button" className="workspace-page-send-retry" onClick={onRetrySend} disabled={sendInFlight}>
                {t('studio.retry')}
              </button>
            )}
            {previewHistoryError && previewHistoryErrorRetryable && publishFooterStatus.message === previewHistoryError && (
              <button type="button" className="workspace-page-send-retry" onClick={onRetryPreviewHistory} disabled={previewHistoryLoading}>
                {t('studio.retry')}
              </button>
            )}
            {draftStoreError && publishFooterStatus.message === draftStoreError && draftStoreBackups.map((index) => (
              <button key={index} type="button" className="workspace-page-send-retry" onClick={() => onRestoreDraftBackup(index)}>
                {t('studio.restoreBackup', { number: index })}
              </button>
            ))}
            {draftStoreError && publishFooterStatus.message === draftStoreError && (
              <button type="button" className="workspace-page-send-retry" onClick={() => window.location.reload()}>
                {t('studio.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function PublishOption({
  action,
  selected,
  onChoose,
  children,
}: {
  action: PublishAction;
  selected: PublishAction;
  onChoose: (action: PublishAction) => void;
  children: React.ReactNode;
}) {
  const actionClass = action === 'schedule' ? 'scheduled' : action;

  return (
    <button
      type="button"
      className={`workspace-page-publish-option is-${actionClass} ${selected === action ? 'is-selected' : ''}`}
      autoFocus={selected === action}
      onClick={() => onChoose(action)}
      role="menuitemradio"
      aria-checked={selected === action}
      onPointerMove={updateGlassPointer}
      onPointerLeave={clearGlassPointer}
    >
      <span>{children}</span>
    </button>
  );
}

function VisiblePreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="workspace-preview-metal" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5fbff" />
          <stop offset="0.4" stopColor="#c2d8e5" />
          <stop offset="0.72" stopColor="#819aaa" />
          <stop offset="1" stopColor="#e0edf4" />
        </linearGradient>
      </defs>
      <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="1.2" />
      <path className="workspace-page-preview-pupil" d="M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4Z" fill="#275d78" />
    </svg>
  );
}

function HiddenPreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="workspace-preview-metal" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5fbff" />
          <stop offset="0.4" stopColor="#c2d8e5" />
          <stop offset="0.72" stopColor="#819aaa" />
          <stop offset="1" stopColor="#e0edf4" />
        </linearGradient>
      </defs>
      <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="rgba(5, 11, 17, 0.86)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.2 12c2.6-3.5 6.2-5.8 9.8-5.8s7.2 2.3 9.8 5.8c-2.6 3.5-6.2 5.8-9.8 5.8S4.8 15.5 2.2 12Z" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.65" fill="none" stroke="url(#workspace-preview-metal)" strokeWidth="1.22" />
      <path className="workspace-page-preview-pupil" d="M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4Z" fill="#275d78" />
    </svg>
  );
}
