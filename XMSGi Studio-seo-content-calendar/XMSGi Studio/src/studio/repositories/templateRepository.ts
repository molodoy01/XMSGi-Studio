import type { Repository, Template } from '../domain/types';
import { createLocalStorageRepository } from './localStorageRepository';

export const templateRepository: Repository<Template> = createLocalStorageRepository<Template>('xmsgi_domain_templates', 'awaitmsg_domain_templates');
