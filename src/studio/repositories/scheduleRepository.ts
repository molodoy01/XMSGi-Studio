import type { Schedule } from '../domain/types';
import type { ScheduleRepository } from '../domain/repositories';
import { createLocalStorageRepository } from './localStorageRepository';

export const scheduleRepository: ScheduleRepository = createLocalStorageRepository<Schedule>('xmsgi_domain_schedules', 'awaitmsg_domain_schedules');
