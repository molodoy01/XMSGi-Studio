export type ChatAvatarResponse = {
  success: boolean;
  avatarDataUrl?: string;
};

type AvatarRequest = {
  chatId: string;
  generation: number;
  fetchAvatar: (chatId: string) => Promise<ChatAvatarResponse>;
  resolve: (avatarDataUrl: string | null) => void;
  promise: Promise<string | null>;
};

export function createChatAvatarLoader(maxConcurrent = 4) {
  const concurrencyLimit = Number.isInteger(maxConcurrent) && maxConcurrent > 0
    ? maxConcurrent
    : 4;
  const cachedAvatars = new Map<string, string>();
  const inFlight = new Map<string, Promise<string | null>>();
  const queue: AvatarRequest[] = [];
  let activeRequests = 0;
  let generation = 0;

  function startQueuedRequests() {
    while (activeRequests < concurrencyLimit && queue.length > 0) {
      const request = queue.shift()!;
      if (request.generation !== generation) {
        if (inFlight.get(request.chatId) === request.promise) inFlight.delete(request.chatId);
        request.resolve(null);
        continue;
      }

      activeRequests += 1;
      void Promise.resolve()
        .then(() => request.fetchAvatar(request.chatId))
        .then((result) => {
          const avatarDataUrl = result.success ? result.avatarDataUrl || null : null;
          if (avatarDataUrl && request.generation === generation) {
            cachedAvatars.set(request.chatId, avatarDataUrl);
          }
          request.resolve(avatarDataUrl);
        })
        .catch(() => request.resolve(null))
        .finally(() => {
          activeRequests -= 1;
          if (inFlight.get(request.chatId) === request.promise) inFlight.delete(request.chatId);
          startQueuedRequests();
        });
    }
  }

  function requestAvatar(chatId: string, fetchAvatar: (chatId: string) => Promise<ChatAvatarResponse>) {
    const cachedAvatar = cachedAvatars.get(chatId);
    if (cachedAvatar) return Promise.resolve(cachedAvatar);

    const existingRequest = inFlight.get(chatId);
    if (existingRequest) return existingRequest;

    let resolve!: (avatarDataUrl: string | null) => void;
    const promise = new Promise<string | null>((resolvePromise) => { resolve = resolvePromise; });
    const request = { chatId, generation, fetchAvatar, resolve, promise };
    inFlight.set(chatId, promise);
    queue.push(request);
    startQueuedRequests();
    return promise;
  }

  return {
    async load(chatIds: string[], fetchAvatar: (chatId: string) => Promise<ChatAvatarResponse>) {
      const uniqueChatIds = [...new Set(chatIds)];
      const avatars = await Promise.all(uniqueChatIds.map(async (chatId) => [
        chatId,
        await requestAvatar(chatId, fetchAvatar),
      ] as const));
      const loaded = new Map<string, string>();

      avatars.forEach(([chatId, avatarDataUrl]) => {
        if (avatarDataUrl) loaded.set(chatId, avatarDataUrl);
      });
      return loaded;
    },

    clear() {
      generation += 1;
      cachedAvatars.clear();
      inFlight.clear();
    },
  };
}