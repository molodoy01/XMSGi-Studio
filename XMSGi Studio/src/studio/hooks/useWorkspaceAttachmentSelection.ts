import { useRef, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useLocale } from '@studio/lib/i18n';
import {
  convertWebpToTelegramPhoto,
  inferAttachmentMimeType,
  isSupportedPhotoAlbumSource,
} from '../lib/draftAttachments';
import {
  createAttachmentId,
  MAX_ALBUMS,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_SIZE,
  MAX_PHOTOS_PER_ALBUM,
  MAX_STANDALONE_ATTACHMENTS,
  readFileAsDataUrl,
  type WorkspaceAttachment,
} from '../lib/workspaceAttachments';
import { getDraftStorageApi } from '../lib/draftStore';

type AttachmentUsage = {
  count: number;
  standaloneCount: number;
  size: number;
  albumIds: Set<string>;
};

type PendingAttachmentUsage = {
  count: number;
  standaloneCount: number;
  size: number;
};

type UseWorkspaceAttachmentSelectionOptions = {
  attachments: WorkspaceAttachment[];
  setAttachments: Dispatch<SetStateAction<WorkspaceAttachment[]>>;
  attachmentUsageRef: MutableRefObject<AttachmentUsage>;
  attachmentSelectionGenerationRef: MutableRefObject<number>;
  albumAttachmentPositionRef: MutableRefObject<number>;
  albumAttachmentTargetIdRef: MutableRefObject<string | null>;
  draftBody: string;
  setAttachmentError: Dispatch<SetStateAction<string>>;
};

export function useWorkspaceAttachmentSelection({
  attachments,
  setAttachments,
  attachmentUsageRef,
  attachmentSelectionGenerationRef,
  albumAttachmentPositionRef,
  albumAttachmentTargetIdRef,
  draftBody,
  setAttachmentError,
}: UseWorkspaceAttachmentSelectionOptions) {
  const { t } = useLocale();
  const pendingAttachmentUsageRef = useRef(new Map<number, PendingAttachmentUsage>());
  const pendingAlbumIdsRef = useRef(new Set<string>());
  const pendingAlbumPhotoCountsRef = useRef(new Map<string, number>());

  const handleAddFiles = async (files: File[], position = draftBody.length, albumId?: string) => {
    if (!files.length) return 0;

    const selectionGeneration = attachmentSelectionGenerationRef.current;
    setAttachmentError('');

    const currentPendingUsage = pendingAttachmentUsageRef.current.get(selectionGeneration)
      ?? { count: 0, standaloneCount: 0, size: 0 };
    const currentCount = attachmentUsageRef.current.count + currentPendingUsage.count;
    const currentStandaloneCount = attachmentUsageRef.current.standaloneCount + currentPendingUsage.standaloneCount;
    const currentSize = attachmentUsageRef.current.size + currentPendingUsage.size;
    const acceptedFiles: File[] = [];
    let acceptedStandaloneCount = 0;
    let nextSize = currentSize;
    let nextError = '';

    for (const file of files) {
      if (currentCount + acceptedFiles.length >= MAX_ATTACHMENTS) {
        nextError = t('studio.fileCountLimit', { count: MAX_ATTACHMENTS });
        break;
      }

      if (!albumId && currentStandaloneCount + acceptedStandaloneCount >= MAX_STANDALONE_ATTACHMENTS) {
        nextError = t('studio.fileCountLimit', { count: MAX_STANDALONE_ATTACHMENTS });
        break;
      }

      if (file.size > MAX_ATTACHMENT_SIZE) {
        nextError = t('studio.fileSizeLimit', { name: file.name });
        continue;
      }

      if (nextSize + file.size > MAX_ATTACHMENTS_TOTAL_SIZE) {
        nextError = t('studio.totalFileSizeLimit');
        break;
      }

      acceptedFiles.push(file);
      if (!albumId) acceptedStandaloneCount += 1;
      nextSize += file.size;
    }

    const reservedSize = acceptedFiles.reduce((total, file) => total + file.size, 0);
    currentPendingUsage.count += acceptedFiles.length;
    currentPendingUsage.standaloneCount += acceptedStandaloneCount;
    currentPendingUsage.size += reservedSize;
    pendingAttachmentUsageRef.current.set(selectionGeneration, currentPendingUsage);

    const safePosition = Math.max(0, Math.min(position, draftBody.length));
    const copiedAttachments = await Promise.all(acceptedFiles.map(async (file) => {
      const mimeType = file.type || inferAttachmentMimeType(file.name);
      const type = mimeType.startsWith('image/') ? 'image' : 'file';
      try {
        const draftStorage = getDraftStorageApi();
        if (!draftStorage) {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            id: createAttachmentId(), type, name: file.name, mimeType, path: dataUrl,
            size: file.size, previewUrl: type === 'image' ? dataUrl : undefined, position: safePosition,
            ...(albumId ? { albumId } : {}),
          };
        }

        const result = await draftStorage.copyAttachment(file);
        return result.success && result.attachment
          ? {
              id: createAttachmentId(), type, name: file.name, mimeType,
              path: result.attachment.path, size: result.attachment.size, position: safePosition,
              ...(albumId ? { albumId } : {}),
            }
          : { error: result.error || t('studio.fileStoreFailed', { name: file.name }) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : `${file.name} could not be stored.` };
      }
    }));
    const storedAttachments = copiedAttachments.filter((item): item is WorkspaceAttachment => 'path' in item);
    const copyErrors = copiedAttachments.filter((item): item is { error: string } => 'error' in item);
    const pendingUsage = pendingAttachmentUsageRef.current.get(selectionGeneration);
    if (pendingUsage) {
      pendingUsage.count -= acceptedFiles.length;
      pendingUsage.standaloneCount -= acceptedStandaloneCount;
      pendingUsage.size -= reservedSize;
      if (pendingUsage.count === 0 && pendingUsage.standaloneCount === 0 && pendingUsage.size === 0) {
        pendingAttachmentUsageRef.current.delete(selectionGeneration);
      }
    }
    if (selectionGeneration !== attachmentSelectionGenerationRef.current) return;
    attachmentUsageRef.current.count += storedAttachments.length;
    attachmentUsageRef.current.standaloneCount += storedAttachments
      .filter((attachment) => !attachment.albumId)
      .length;
    attachmentUsageRef.current.size += storedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    storedAttachments.forEach((attachment) => {
      if (attachment.albumId) attachmentUsageRef.current.albumIds.add(attachment.albumId);
    });
    if (storedAttachments.length) setAttachments((current) => [...current, ...storedAttachments]);

    const errors = [nextError, ...copyErrors.map((item) => item.error)].filter(Boolean);
    if (errors.length) setAttachmentError(errors.join(' '));
    return storedAttachments.length;
  };

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    await handleAddFiles(files);
    input.value = '';
  };

  const handleAlbumFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    const targetAlbumId = albumAttachmentTargetIdRef.current;
    albumAttachmentTargetIdRef.current = null;
    input.value = '';
    const selectedImages = files.filter((file) => (
      file.type.startsWith('image/') || inferAttachmentMimeType(file.name).startsWith('image/')
    ));
    if (selectedImages.length === 0) {
      setAttachmentError(t('studio.photoAlbumImagesOnly'));
      return;
    }
    if (selectedImages.some((file) => !isSupportedPhotoAlbumSource(file))) {
      setAttachmentError(t('studio.photoAlbumSupportedFormats'));
      return;
    }

    const existingAlbumIds = new Set([
      ...attachmentUsageRef.current.albumIds,
      ...pendingAlbumIdsRef.current,
    ]);
    if (!targetAlbumId && existingAlbumIds.size >= MAX_ALBUMS) {
      setAttachmentError(t('studio.photoAlbumCountLimit', { count: MAX_ALBUMS }));
      return;
    }

    const existingPhotoCount = targetAlbumId
      ? attachments.filter((attachment) => attachment.albumId === targetAlbumId).length
      : 0;
    const pendingPhotoCount = targetAlbumId
      ? pendingAlbumPhotoCountsRef.current.get(targetAlbumId) ?? 0
      : 0;
    const availablePhotoSlots = Math.max(0, MAX_PHOTOS_PER_ALBUM - existingPhotoCount - pendingPhotoCount);
    if (availablePhotoSlots === 0) {
      setAttachmentError(t('studio.photoAlbumPhotoLimit', { count: MAX_PHOTOS_PER_ALBUM }));
      return;
    }

    const albumId = targetAlbumId ?? createAttachmentId();
    const selectedAlbumImages = selectedImages.slice(0, availablePhotoSlots);
    const exceededAlbumLimit = selectedImages.length > availablePhotoSlots;
    if (targetAlbumId) {
      pendingAlbumPhotoCountsRef.current.set(albumId, pendingPhotoCount + selectedAlbumImages.length);
    } else {
      pendingAlbumIdsRef.current.add(albumId);
    }
    try {
      const telegramPhotos = await Promise.all(selectedAlbumImages.map(convertWebpToTelegramPhoto));
      await handleAddFiles(telegramPhotos, albumAttachmentPositionRef.current, albumId);
    } catch {
      setAttachmentError(t('studio.photoAlbumConversionFailed'));
    } finally {
      if (targetAlbumId) {
        const remainingPending = (pendingAlbumPhotoCountsRef.current.get(albumId) ?? 0) - selectedAlbumImages.length;
        if (remainingPending > 0) pendingAlbumPhotoCountsRef.current.set(albumId, remainingPending);
        else pendingAlbumPhotoCountsRef.current.delete(albumId);
      } else {
        pendingAlbumIdsRef.current.delete(albumId);
      }
    }
    if (exceededAlbumLimit) {
      setAttachmentError(t('studio.photoAlbumPhotoLimit', { count: MAX_PHOTOS_PER_ALBUM }));
    }
  };

  return { handleAddFiles, handleFileSelection, handleAlbumFileSelection };
}
