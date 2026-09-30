import { z } from 'zod';

export const ProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).default(''),
  /** Absolute path to a local folder. Optional: a project can exist without a workspace. */
  path: z.string().max(1024).nullable().default(null),
  budgetUsd: z.number().min(0).max(10_000).default(5),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string | null;
  isGit: boolean;
  budgetUsd: number;
  createdAt: number;
  updatedAt: number;
}
