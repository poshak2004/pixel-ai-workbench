export type ArtifactKind = 'proposal' | 'final_result' | 'file' | 'diff' | 'report';

export interface ArtifactRecord {
  id: string;
  runId: string;
  seatId: string | null;
  kind: ArtifactKind;
  title: string;
  mimeType: string;
  content: string;
  createdAt: number;
}
