import type { Account, Draft, Post, Repository, Schedule } from './types';

export type DraftRepository = Repository<Draft>;

export type PostRepository = Repository<Post>;

export type ScheduleRepository = Repository<Schedule>;

export type AccountRepository = Repository<Account>;