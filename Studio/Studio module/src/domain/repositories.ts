import type { Account, Draft, Post, Repository, Schedule } from './types';

export interface DraftRepository extends Repository<Draft> {}

export interface PostRepository extends Repository<Post> {}

export interface ScheduleRepository extends Repository<Schedule> {}

export interface AccountRepository extends Repository<Account> {}