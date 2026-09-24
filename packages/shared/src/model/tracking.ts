export interface IssueMetadata {
  id: string;
  repositoryId: string;
  fullName: string;
  number: number;
  title: string;
  body: string | null;
  status: 'open' | 'closed';
  creatorEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommentMetadata {
  id: string;
  issueId: string | null;
  authorEmail: string;
  body: string;
  createdAt: number;
}

export interface LabelMetadata {
  id: string;
  repositoryId: string;
  name: string;
  color: string;
  description: string | null;
  createdAt: number;
}

export interface MilestoneMetadata {
  id: string;
  repositoryId: string;
  title: string;
  description: string | null;
  dueOn: number | null;
  status: 'open' | 'closed';
  createdAt: number;
}

export interface PullReviewerMetadata {
  pullRequestId: string;
  userEmail: string;
  status: 'pending' | 'approved' | 'changes_requested';
  createdAt: number;
}
