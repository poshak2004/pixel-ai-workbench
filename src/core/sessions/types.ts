/** A session groups related runs (e.g. an afternoon's work on one problem) within a project. */
export interface Session {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}
