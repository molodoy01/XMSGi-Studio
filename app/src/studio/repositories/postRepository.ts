import type { Post } from '../domain/types';
import type { PostRepository } from '../domain/repositories';
import { createLocalStorageRepository } from './localStorageRepository';

export const postRepository: PostRepository = createLocalStorageRepository<Post>('xmsgi_domain_posts', 'awaitmsg_domain_posts');