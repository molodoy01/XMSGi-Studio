import type { Draft } from '../domain/types';
import type { DraftRepository } from '../domain/repositories';
import { createLocalStorageRepository } from './localStorageRepository';

export const draftRepository: DraftRepository = createLocalStorageRepository<Draft>('xmsgi_domain_drafts', 'awaitmsg_domain_drafts');
