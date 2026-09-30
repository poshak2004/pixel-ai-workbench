import { z } from 'zod';
import { PermissionGrantSchema } from '../security/permissions';

export const ModelRefSchema = z.object({ providerId: z.string().min(1), modelId: z.string().min(1) });

/**
 * An agent is Role + Model + rules + tools + permissions. The role (constitution) defines behaviour;
 * the model supplies intelligence. They are referenced separately so either can change independently.
 */
export const AgentSpecSchema = z.object({
  name: z.string().min(1).max(80),
  roleId: z.string().min(1),
  objective: z.string().max(2000).default(''),
  model: ModelRefSchema,
  /** Agent-level instructions. Lowest-precedence rules; they cannot relax role or governance rules. */
  systemRules: z.array(z.string().max(1000)).default([]),
  /** Tool names this agent may be offered. Still subject to permissions and governance. */
  allowedTools: z.array(z.string()).default([]),
  permissions: PermissionGrantSchema,
  memoryPolicy: z.enum(['none', 'run', 'project']).default('run'),
  maxOutputTokens: z.number().int().min(256).max(128_000).default(4096),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  spec: AgentSpecSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Agent = z.infer<typeof AgentSchema>;
