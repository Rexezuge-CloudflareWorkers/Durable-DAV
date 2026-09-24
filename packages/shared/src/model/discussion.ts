export interface DiscussionCategoryMetadata {
  id: string;
  repositoryId: string;
  slug: string;
  title: string;
  description: string | null;
  kind: 'general' | 'qa' | 'announcement' | 'ideas';
  createdAt: number;
}

export interface DiscussionMetadata {
  id: string;
  repositoryId: string;
  categoryId: string | null;
  number: number;
  title: string;
  body: string | null;
  authorEmail: string;
  status: 'open' | 'locked' | 'answered';
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionCommentMetadata {
  id: string;
  discussionId: string;
  authorEmail: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
