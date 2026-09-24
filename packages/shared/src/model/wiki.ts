export interface WikiPageMetadata {
  id: string;
  repositoryId: string;
  slug: string;
  title: string;
  body: string;
  revision: number;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface WikiRevisionMetadata {
  id: string;
  pageId: string;
  revision: number;
  body: string;
  authorEmail: string;
  createdAt: number;
}
