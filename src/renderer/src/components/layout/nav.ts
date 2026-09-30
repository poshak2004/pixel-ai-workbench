import { Activity, Bot, Boxes, Cpu, FlaskConical, FolderGit2, GitBranch, Home, Layers, Plug, Settings, Table2, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Home', icon: Home, hint: 'Overview and recent runs' },
  { path: '/playground', label: 'Playground', icon: FlaskConical, hint: 'Run a single agent' },
  { path: '/agents', label: 'Agents', icon: Bot, hint: 'Agents, roles and constitutions' },
  { path: '/tables', label: 'Tables', icon: Table2, hint: 'Councils of agents' },
  { path: '/workflows', label: 'Workflows', icon: GitBranch, hint: 'Visual multi-step pipelines' },
  { path: '/projects', label: 'Projects', icon: FolderGit2, hint: 'Workspaces, git and permissions' },
  { path: '/runs', label: 'Runs', icon: Activity, hint: 'Every execution, inspectable' },
  { path: '/sessions', label: 'Sessions', icon: Layers, hint: 'Runs grouped by project and day' },
  { path: '/models', label: 'Models', icon: Cpu, hint: 'Providers, keys, models and the observatory' },
  { path: '/usage', label: 'Usage', icon: Boxes, hint: 'Tokens, latency and cost' },
  { path: '/mcp', label: 'MCP', icon: Plug, hint: 'Model Context Protocol servers' },
  { path: '/settings', label: 'Settings', icon: Settings, hint: 'Governance, security, appearance' },
];
