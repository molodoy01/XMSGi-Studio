import type { Dispatch, SetStateAction } from 'react';
import type { Chat, DraftColor, RichTextEntity, SavedDraft, Template } from '@/types';
import type { ScheduleRepeatOptions } from '@/lib/scheduling';
import { ButtonsStage } from '@/components/stages/ButtonsStage';
import { ChatSelectionStage } from '@/components/stages/ChatSelectionStage';
import { DraftsStage } from '@/components/stages/DraftsStage';
import { ScheduleStage } from '@/components/stages/ScheduleStage';
import { TemplatesStage } from '@/components/stages/TemplatesStage';
import type { InlineButtonRow } from '@/lib/inlineKeyboard';
import type { StageMode } from '@/components/stages/types';

interface Props {
  mode: StageMode;
  scheduleFocus?: 'repeat' | 'time' | null;
  onModeChange: (mode: StageMode) => void;
  onScheduleDone?: () => void;
  selectedChat: Chat | null;
  chats: Chat[];
  selectedChats: Chat[];
  onChatSelectionChange: (chats: Chat[]) => void;
  onChatSelectionDone: () => void;
  onChatSelectionBack: () => void;
  onChatError: (message: string) => void;
  onAddChat: (chat: Chat) => void;
  onRemoveChat: (chat: Chat) => void;
  draftBody: string;
  draftEntities: RichTextEntity[];
  date: string;
  time: string;
  setDate: Dispatch<SetStateAction<string>>;
  setTime: Dispatch<SetStateAction<string>>;
  scheduling: boolean;
  canSchedule: boolean;
  onSchedule: (entities: RichTextEntity[], repeat: ScheduleRepeatOptions) => void;
  repeatMode: ScheduleRepeatOptions['mode'];
  setRepeatMode: Dispatch<SetStateAction<ScheduleRepeatOptions['mode']>>;
  repeatDays: string[];
  setRepeatDays: Dispatch<SetStateAction<string[]>>;
  repeatOccurrences: number;
  setRepeatOccurrences: Dispatch<SetStateAction<number>>;
  templates: Template[];
  onInsertTemplate: (body: string) => void;
  templateEditingId: string | null;
  templateDraftName: string;
  setTemplateDraftName: Dispatch<SetStateAction<string>>;
  templateDraftBody: string;
  setTemplateDraftBody: Dispatch<SetStateAction<string>>;
  openTemplateEditor: (template?: Template) => void;
  onDeleteTemplate: (template: Template) => void;
  closeTemplateEditor: () => void;
  saveTemplateStage: () => void;
  savedDrafts: SavedDraft[];
  onInsertDraft: (draft: SavedDraft) => void;
  draftEditingId: string | null;
  draftColor: DraftColor;
  setDraftColor: Dispatch<SetStateAction<DraftColor>>;
  draftName: string;
  setDraftName: Dispatch<SetStateAction<string>>;
  draftBodyText: string;
  setDraftBodyText: Dispatch<SetStateAction<string>>;
  openDraftEditor: (draft?: SavedDraft) => void;
  onDeleteDraft: (draft: SavedDraft) => void;
  closeDraftEditor: () => void;
  saveDraftStage: () => void;
  draftStoreReady: boolean;
  draftStoreSaving: boolean;
  onExportDrafts: () => void;
  onImportDrafts: () => void;
  onImportEditorText: () => void;
  inlineButtons: InlineButtonRow[];
  setInlineButtons: (rows: InlineButtonRow[]) => void;
}

export function WorkspaceTextStage({
  mode,
  scheduleFocus = null,
  onModeChange,
  onScheduleDone,
  chats,
  selectedChats,
  onChatSelectionChange,
  onChatSelectionDone,
  onChatSelectionBack,
  onChatError,
  onAddChat,
  onRemoveChat,
  date,
  time,
  setDate,
  setTime,
  repeatMode,
  setRepeatMode,
  repeatDays,
  setRepeatDays,
  repeatOccurrences,
  setRepeatOccurrences,
  templates,
  onInsertTemplate,
  templateEditingId,
  templateDraftName,
  setTemplateDraftName,
  templateDraftBody,
  setTemplateDraftBody,
  openTemplateEditor,
  onDeleteTemplate,
  closeTemplateEditor,
  saveTemplateStage,
  savedDrafts,
  onInsertDraft,
  draftEditingId,
  draftColor,
  setDraftColor,
  draftName,
  setDraftName,
  draftBodyText,
  setDraftBodyText,
  openDraftEditor,
  onDeleteDraft,
  closeDraftEditor,
  saveDraftStage,
  draftStoreReady,
  draftStoreSaving,
  onExportDrafts,
  onImportDrafts,
  onImportEditorText,
  inlineButtons,
  setInlineButtons,
}: Props) {
  return (
    <>
      <ScheduleStage
        mode={mode}
        scheduleFocus={scheduleFocus}
        onModeChange={onModeChange}
        onScheduleDone={onScheduleDone}
        date={date}
        time={time}
        setDate={setDate}
        setTime={setTime}
        repeatMode={repeatMode}
        setRepeatMode={setRepeatMode}
        repeatDays={repeatDays}
        setRepeatDays={setRepeatDays}
        repeatOccurrences={repeatOccurrences}
        setRepeatOccurrences={setRepeatOccurrences}
      />

      <TemplatesStage
        mode={mode}
        onModeChange={onModeChange}
        templates={templates}
        onInsertTemplate={onInsertTemplate}
        templateEditingId={templateEditingId}
        templateDraftName={templateDraftName}
        setTemplateDraftName={setTemplateDraftName}
        templateDraftBody={templateDraftBody}
        setTemplateDraftBody={setTemplateDraftBody}
        openTemplateEditor={openTemplateEditor}
        onDeleteTemplate={onDeleteTemplate}
        closeTemplateEditor={closeTemplateEditor}
        saveTemplateStage={saveTemplateStage}
      />

      <DraftsStage
        mode={mode}
        onModeChange={onModeChange}
        savedDrafts={savedDrafts}
        onInsertDraft={onInsertDraft}
        draftEditingId={draftEditingId}
        draftColor={draftColor}
        setDraftColor={setDraftColor}
        draftName={draftName}
        setDraftName={setDraftName}
        draftBodyText={draftBodyText}
        setDraftBodyText={setDraftBodyText}
        openDraftEditor={openDraftEditor}
        onDeleteDraft={onDeleteDraft}
        closeDraftEditor={closeDraftEditor}
        saveDraftStage={saveDraftStage}
        draftStoreReady={draftStoreReady}
        draftStoreSaving={draftStoreSaving}
        onExportDrafts={onExportDrafts}
        onImportDrafts={onImportDrafts}
        onImportEditorText={onImportEditorText}
      />

      <ButtonsStage mode={mode} inlineButtons={inlineButtons} setInlineButtons={setInlineButtons} onModeChange={onModeChange} />

      <ChatSelectionStage
        mode={mode}
        chats={chats}
        selectedChats={selectedChats}
        onChatSelectionChange={onChatSelectionChange}
        onChatSelectionDone={onChatSelectionDone}
        onChatSelectionBack={onChatSelectionBack}
        onChatError={onChatError}
        onAddChat={onAddChat}
        onRemoveChat={onRemoveChat}
      />
    </>
  );
}
