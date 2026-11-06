import type { Account } from '../domain/types';
import type { AccountRepository } from '../domain/repositories';
import { createLocalStorageRepository } from './localStorageRepository';

export const accountRepository: AccountRepository = createLocalStorageRepository<Account>('xmsgi_domain_accounts', 'awaitmsg_domain_accounts');