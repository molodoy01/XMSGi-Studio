import type { StudioPlannerTextPayload } from '@shared/bridge';

export function getPlannerAttachmentPaths(
  attachments: Array<{ path?: string | null; sourcePath?: string | null }>,
) {
  return attachments.flatMap(({ path, sourcePath }) => {
    const resolvedPath = path || sourcePath;
    return resolvedPath ? [resolvedPath] : [];
  });
}

export function hasPlannerPayloadContent(payload: Pick<StudioPlannerTextPayload, 'text' | 'attachments'>) {
  return payload.text.trim().length > 0 || payload.attachments.some((attachment) => attachment.trim().length > 0);
}