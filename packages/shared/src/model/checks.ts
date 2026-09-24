export type CheckRunStatus = 'queued' | 'in_progress' | 'completed';

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';

export type CheckCombinedState = 'pending' | 'success' | 'failure';

export interface CheckRunMetadata {
  id: string;
  repositoryId: string;
  headSha: string;
  context: string;
  status: CheckRunStatus;
  conclusion: CheckConclusion | null;
  detailsUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  creatorEmail: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
