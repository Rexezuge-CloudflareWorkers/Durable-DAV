export interface RepositoryMetadata {
  id: string;
  ownerEmail: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
}
