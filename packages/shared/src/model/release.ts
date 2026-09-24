export interface ReleaseMetadata {
  id: string;
  repositoryId: string;
  tagName: string;
  name: string;
  body: string;
  isDraft: boolean;
  isPrerelease: boolean;
  createdBy: string;
  createdAt: number;
  publishedAt: number | null;
}

export interface ReleaseAssetMetadata {
  id: string;
  releaseId: string;
  repositoryId: string;
  name: string;
  size: number;
  contentType: string;
  sha256: string;
  createdBy: string;
  createdAt: number;
}
