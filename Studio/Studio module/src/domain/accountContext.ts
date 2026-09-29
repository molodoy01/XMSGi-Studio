const DEFAULT_CURRENT_ACCOUNT_ID = 'default-account';

let currentAccountId = DEFAULT_CURRENT_ACCOUNT_ID;

export function getCurrentAccountId(): string {
  return currentAccountId;
}

export function setCurrentAccountId(accountId: string): string {
  const nextAccountId = accountId?.trim?.() || DEFAULT_CURRENT_ACCOUNT_ID;
  currentAccountId = nextAccountId || DEFAULT_CURRENT_ACCOUNT_ID;
  return currentAccountId;
}

export function resetCurrentAccountId(): string {
  currentAccountId = DEFAULT_CURRENT_ACCOUNT_ID;
  return currentAccountId;
}

export function resolveAccountId(accountId?: string): string {
  const value = accountId?.trim?.() || currentAccountId || DEFAULT_CURRENT_ACCOUNT_ID;
  return value || DEFAULT_CURRENT_ACCOUNT_ID;
}

export { DEFAULT_CURRENT_ACCOUNT_ID };
