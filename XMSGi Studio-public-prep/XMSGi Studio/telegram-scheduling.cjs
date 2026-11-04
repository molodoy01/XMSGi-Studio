const { normalizeTelegramMessage } = require('./packages/shared/telegramText.cjs');
const { prepareInlineKeyboard } = require('./telegram-inline-keyboard.cjs');
const { isInvalidMediaAlbumError } = require('./telegram-errors.cjs');
const { toTelegramFormattingEntities } = require('./telegram-message-entities.cjs');
const {
  matchesScheduledOperation,
  createScheduleIdempotencyKey,
} = require('./telegram-idempotency.cjs');
const { findRecentSentMessage } = require('./schedule-history.cjs');
const {
  logTelegramOperation,
  withTelegramInvokeDiagnostics,
} = require('./telegram-publish-diagnostics.cjs');

const REQUEST_TIMEOUT = 15000;
const MEDIA_REQUEST_TIMEOUT = 120000;

function createTelegramScheduler({
  Api,
  connectTelegram,
  getClient,
  getTelegramRequestTimeout,
  scheduleCleanupRetryDelay,
  telegramRequest,
  withTimeout,
}) {
  async function scheduleMessageInternal(
    chatId,
    message,
    date,
    time,
    targetTimestamp,
    attachments = [],
    entities = [],
    replyMarkup,
    silent = false,
    effect
  ) {
    const normalized = normalizeTelegramMessage(message, entities);
    message = normalized.message;
    entities = normalized.entities;

    if (!getClient()) {
      await connectTelegram();
    }

    const target = chatId === 'me' ? 'me' : chatId;
    const scheduledDate = typeof targetTimestamp === 'number' && Number.isFinite(targetTimestamp)
      ? targetTimestamp
      : Math.floor(new Date(`${date}T${time}`).getTime() / 1000);

    if (!Number.isFinite(scheduledDate)) {
      throw new Error('Invalid schedule date or time');
    }

    const scheduleOperationDetails = {
      message,
      targetTimestamp: scheduledDate,
      attachments,
      entities,
      replyMarkup,
      silent: silent === true,
      effect,
    };
    const scheduleIdempotencyKey = await createScheduleIdempotencyKey(target, scheduleOperationDetails);

    if (attachments.length === 0) {
      const existingScheduledMessages = await telegramRequest(() => withTimeout(
        getClient().getScheduledMessages(target),
        REQUEST_TIMEOUT,
        'Checking existing Telegram schedule'
      ));
      const existingScheduledMessage = existingScheduledMessages.find(
        (scheduledMessage) => matchesScheduledOperation(scheduledMessage, scheduleOperationDetails)
      );

      if (existingScheduledMessage) {
        return {
          id: existingScheduledMessage.id,
          telegramMessageId: existingScheduledMessage.id,
          confirmed: true,
          operationIdentity: scheduleIdempotencyKey,
        };
      }
    }

    const sendOptions = { message, schedule: scheduledDate };

    if (silent) sendOptions.silent = true;
    if (effect !== undefined) sendOptions.effect = BigInt(effect);
    if (entities.length > 0) {
      sendOptions.formattingEntities = toTelegramFormattingEntities(entities);
    }
    if (attachments.length > 0) {
      sendOptions.file = attachments.length === 1 ? attachments[0] : attachments;
    }

    const preparedMarkup = prepareInlineKeyboard(replyMarkup);
    sendOptions.buttons = attachments.length > 0 ? preparedMarkup : undefined;

    const useDirectSchedule = attachments.length === 0
      && typeof getClient().getInputEntity === 'function'
      && typeof getClient().invoke === 'function';
    const scheduleOperation = !useDirectSchedule
      ? () => getClient().sendMessage(target, sendOptions)
      : async () => {
        const peer = await getClient().getInputEntity(target);
        const request = new Api.messages.SendMessage({
          peer,
          message,
          entities: sendOptions.formattingEntities,
          replyMarkup: preparedMarkup,
          scheduleDate: scheduledDate,
          silent: sendOptions.silent === true,
          ...(sendOptions.effect !== undefined ? { effect: sendOptions.effect } : {}),
        });
        return getClient().invoke(request);
      };

    logTelegramOperation('schedule', message, attachments, replyMarkup);

    const scheduleRequestTimeout = getTelegramRequestTimeout(attachments);
    let telegramMessageIds = [];
    let scheduleConfirmedByResponse = false;
    let sentImmediatelyByResponse = false;
    const captureScheduleResponse = (response) => {
      const updates = Array.isArray(response?.updates)
        ? response.updates
        : response?.update
          ? [response.update]
          : [response];
      const responseIds = updates.flatMap((update) => {
        if (update?.className === 'UpdateNewScheduledMessage' && update.message?.id != null) {
          return [update.message.id];
        }
        return update?.className === 'UpdateMessageID' && update.id != null ? [update.id] : [];
      });
      scheduleConfirmedByResponse ||= updates.some(
        (update) => update?.className === 'UpdateNewScheduledMessage'
      );
      sentImmediatelyByResponse ||= updates.some((update) => (
        update?.className === 'UpdateNewMessage'
        || update?.className === 'UpdateNewChannelMessage'
      ));
      telegramMessageIds = [...new Map(
        [...telegramMessageIds, ...responseIds].map((id) => [String(id), id])
      ).values()];
    };

    let sendResult;
    try {
      sendResult = await withTelegramInvokeDiagnostics(getClient(), 'schedule', () => telegramRequest(() => withTimeout(
        scheduleOperation(),
        scheduleRequestTimeout,
        attachments.length > 0 ? 'Scheduling Telegram media' : 'Scheduling Telegram message'
      )), scheduleIdempotencyKey, captureScheduleResponse);
    } catch (error) {
      if (attachments.length < 2 || !isInvalidMediaAlbumError(error)) throw error;

      console.warn('[Telegram schedule] album rejected; scheduling attachments separately', {
        attachmentCount: attachments.length,
        errorCode: error?.code || 'MEDIA_INVALID',
      });

      const individualResults = [];
      try {
        for (const [index, attachment] of attachments.entries()) {
          const attachmentOptions = {
            ...sendOptions,
            message: index === 0 ? message : '',
            formattingEntities: index === 0 ? sendOptions.formattingEntities : undefined,
            file: attachment,
            buttons: index === 0 ? preparedMarkup : undefined,
          };
          const attachmentIdempotencyKey = `${scheduleIdempotencyKey}:attachment:${index}`;
          const result = await withTelegramInvokeDiagnostics(getClient(), 'schedule', () => telegramRequest(() => withTimeout(
            getClient().sendMessage(target, attachmentOptions),
            MEDIA_REQUEST_TIMEOUT,
            'Scheduling Telegram attachment'
          )), attachmentIdempotencyKey, captureScheduleResponse);
          individualResults.push(result);
        }
      } catch (fallbackError) {
        const partialIds = [...new Map([
          ...telegramMessageIds,
          ...individualResults.flatMap((result) => (Array.isArray(result) ? result : [result])
            .map((item) => item?.id)
            .filter((id) => id !== undefined && id !== null)),
        ].map((id) => [String(id), Number(id)])).values()];

        if (partialIds.length > 0) {
          const cleanupRetryDelays = [1000, 2000, 5000];
          const waitForCleanupRetry = typeof scheduleCleanupRetryDelay === 'function'
            ? scheduleCleanupRetryDelay
            : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
          let remainingIds = partialIds;

          for (const delayMilliseconds of cleanupRetryDelays) {
            if (remainingIds.length === 0) break;
            await waitForCleanupRetry(delayMilliseconds);

            try {
              await telegramRequest(() => withTimeout(
                getClient().deleteScheduledMessages(target, remainingIds),
                REQUEST_TIMEOUT,
                'Cleaning up a partial Telegram media schedule'
              ));
              remainingIds = [];
            } catch (cleanupError) {
              console.error('Telegram partial media schedule cleanup failed:', cleanupError?.code || cleanupError?.name || 'unknown');
              try {
                const stillScheduled = await telegramRequest(() => withTimeout(
                  getClient().getScheduledMessages(target, remainingIds),
                  REQUEST_TIMEOUT,
                  'Checking remaining partial Telegram media schedules'
                ));
                const stillScheduledIds = new Set(stillScheduled.map((item) => String(item.id)));
                remainingIds = remainingIds.filter((id) => stillScheduledIds.has(String(id)));
              } catch (lookupError) {
                console.error('Telegram partial media schedule reconciliation failed:', lookupError?.code || lookupError?.name || 'unknown');
              }
            }
          }

          if (remainingIds.length > 0) {
            const partialError = fallbackError instanceof Error
              ? fallbackError
              : new Error(String(fallbackError));
            partialError.telegramMessageId = remainingIds[0];
            partialError.telegramMessageIds = remainingIds;
            throw partialError;
          }
        }
        throw fallbackError;
      }

      sendResult = individualResults;
    }

    const returnedMessageIds = (Array.isArray(sendResult) ? sendResult : [sendResult])
      .map((messageResult) => messageResult?.id)
      .filter((id) => id !== undefined && id !== null);
    if (returnedMessageIds.length > 0) {
      telegramMessageIds = [...new Map(
        [...telegramMessageIds, ...returnedMessageIds].map((id) => [String(id), id])
      ).values()];
    }

    if (sentImmediatelyByResponse && !scheduleConfirmedByResponse) {
      throw new Error('Telegram sent the message immediately instead of scheduling it.');
    }

    let confirmedMessage = scheduleConfirmedByResponse && telegramMessageIds.length > 0
      ? { id: telegramMessageIds[0] }
      : null;

    if (!confirmedMessage) {
      const scheduledMessages = await telegramRequest(() => withTimeout(
        getClient().getScheduledMessages(target),
        REQUEST_TIMEOUT,
        'Verifying scheduled Telegram message'
      ));
      const confirmedMessages = telegramMessageIds.map((messageId) => scheduledMessages.find(
        (scheduledMessage) => String(scheduledMessage.id) === String(messageId)
      )).filter(Boolean);
      confirmedMessage = confirmedMessages[0] ?? null;

      if (telegramMessageIds.length > 0 && confirmedMessages.length !== telegramMessageIds.length) {
        confirmedMessage = null;
      }

      if (!confirmedMessage && attachments.length === 0) {
        confirmedMessage = scheduledMessages.find(
          (scheduledMessage) => matchesScheduledOperation(scheduledMessage, scheduleOperationDetails)
        );
      }
    }

    if (!confirmedMessage) {
      console.error('Telegram did not confirm the scheduled message.');
      throw new Error('Telegram did not confirm that the reminder was saved.');
    }

    console.log('Telegram schedule confirmed.');

    return {
      id: confirmedMessage.id,
      telegramMessageId: confirmedMessage.id,
      telegramMessageIds,
      confirmed: true,
      operationIdentity: scheduleIdempotencyKey,
    };
  }

  async function reconcilePendingScheduleInternal({
    chatId,
    message,
    targetTimestamp,
    attachments = [],
    entities = [],
    replyMarkup,
    silent = false,
    effect,
    telegramMessageIds = [],
  }) {
    if (!getClient()) {
      await connectTelegram();
    }

    const target = chatId === 'me' ? 'me' : chatId;
    const clientAtStart = getClient();
    const operation = {
      message,
      targetTimestamp,
      attachments,
      entities,
      replyMarkup,
      silent: silent === true,
      effect,
    };
    const expectedIds = new Set(telegramMessageIds.map(String));
    const scheduledMessages = await telegramRequest(() => withTimeout(
      clientAtStart.getScheduledMessages(target),
      REQUEST_TIMEOUT,
      'Checking restored Telegram schedule'
    ));
    if (getClient() !== clientAtStart) {
      throw new Error('Telegram schedule reconciliation was cancelled.');
    }

    const matchingById = expectedIds.size > 0
      ? scheduledMessages.filter((scheduledMessage) => expectedIds.has(String(scheduledMessage.id)))
      : [];
    if (expectedIds.size > 0 && matchingById.length === expectedIds.size) {
      const ids = matchingById.map((item) => item.id);
      return {
        state: 'scheduled',
        telegramMessageId: ids[0],
        telegramMessageIds: ids,
      };
    }
    if (expectedIds.size > 0) return { state: 'unknown' };

    const matchingScheduled = attachments.length === 0
      ? scheduledMessages.filter((scheduledMessage) => matchesScheduledOperation(scheduledMessage, operation))
      : [];
    if (matchingScheduled.length === 1) {
      return {
        state: 'scheduled',
        telegramMessageId: matchingScheduled[0].id,
        telegramMessageIds: [matchingScheduled[0].id],
      };
    }
    if (matchingScheduled.length > 1) return { state: 'unknown' };

    return { state: 'unknown' };
  }

  async function cancelScheduledMessageInternal(chatId, messageId, message, targetTimestamp) {
    if (!getClient()) {
      await connectTelegram();
    }

    const target = chatId === 'me' ? 'me' : chatId;
    const clientAtStart = getClient();
    let telegramMessageIds = Array.isArray(messageId)
      ? messageId
      : messageId === undefined || messageId === null
        ? []
        : [messageId];

    const findAlreadySentMessage = async () => {
      if (!message || !Number.isFinite(targetTimestamp)) return null;
      try {
        const entity = await telegramRequest(() => withTimeout(
          clientAtStart.getEntity(target),
          REQUEST_TIMEOUT,
          'Resolving Telegram chat to reconcile a scheduled message'
        ));
        const recentMessages = await telegramRequest(() => withTimeout(
          clientAtStart.getMessages(entity, { limit: 50 }),
          REQUEST_TIMEOUT,
          'Checking whether Telegram already sent a scheduled message'
        ));
        if (getClient() !== clientAtStart) return null;
        return findRecentSentMessage(recentMessages, message, targetTimestamp);
      } catch {
        return null;
      }
    };

    if (telegramMessageIds.length === 0) {
      const scheduledMessages = await telegramRequest(() => clientAtStart.getScheduledMessages(target));

      if (getClient() !== clientAtStart) {
        throw new Error('Telegram cancel was cancelled.');
      }

      const foundMessage = scheduledMessages.find((scheduledMessage) => {
        const messageTimestamp = scheduledMessage.date instanceof Date
          ? Math.floor(scheduledMessage.date.getTime() / 1000)
          : Number(scheduledMessage.date);
        return scheduledMessage.message === message
          && Math.abs(messageTimestamp - targetTimestamp) <= 10;
      });

      if (!foundMessage) {
        const sentMessage = await findAlreadySentMessage();
        if (sentMessage) {
          return {
            success: true,
            alreadySent: true,
            telegramMessageId: String(sentMessage.id),
            sentAt: sentMessage.date instanceof Date
              ? sentMessage.date.toISOString()
              : new Date(Number(sentMessage.date) * 1000).toISOString(),
          };
        }
        throw new Error('Scheduled message was not found in Telegram.');
      }

      telegramMessageIds = [foundMessage.id];
    }

    try {
      await telegramRequest(() => clientAtStart.deleteScheduledMessages(
        target,
        telegramMessageIds.map(Number)
      ));
    } catch (error) {
      const sentMessage = await findAlreadySentMessage();
      if (sentMessage) {
        return {
          success: true,
          alreadySent: true,
          telegramMessageId: String(sentMessage.id),
          sentAt: sentMessage.date instanceof Date
            ? sentMessage.date.toISOString()
            : new Date(Number(sentMessage.date) * 1000).toISOString(),
        };
      }
      throw error;
    }

    if (getClient() !== clientAtStart) {
      throw new Error('Telegram cancel was cancelled.');
    }

    console.log('Scheduled message cancelled successfully');
    return { success: true, alreadySent: false };
  }

  return { scheduleMessageInternal, reconcilePendingScheduleInternal, cancelScheduledMessageInternal };
}

module.exports = { createTelegramScheduler };