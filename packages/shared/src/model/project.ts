export interface ProjectMetadata {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string | null;
  status: 'open' | 'closed';
  creatorEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectColumnMetadata {
  id: string;
  projectId: string;
  title: string;
  position: number;
  createdAt: number;
}

export interface ProjectCardMetadata {
  id: string;
  projectId: string;
  columnId: string;
  kind: 'note' | 'issue' | 'pull';
  noteTitle: string | null;
  noteBody: string | null;
  issueId: string | null;
  pullRequestId: string | null;
  position: number;
  archived: boolean;
  creatorEmail: string;
  createdAt: number;
  updatedAt: number;
}
