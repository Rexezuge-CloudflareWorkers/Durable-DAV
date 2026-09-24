export interface SnippetMetadata {
  id: string;
  ownerEmail: string;
  title: string;
  visibility: 'public' | 'secret';
  createdAt: number;
  updatedAt: number;
}

export interface SnippetFileMetadata {
  id: string;
  snippetId: string;
  filename: string;
  body: string;
  createdAt: number;
}
