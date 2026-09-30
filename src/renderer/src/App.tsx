import { useEffect, useState } from 'react';
import { CommandPalette } from './components/layout/CommandPalette';
import { Sidebar } from './components/layout/Sidebar';
import { useRoute } from './lib/router';
import { wirePushInvalidation } from './lib/store';
import { AgentsPage } from './pages/Agents';
import { HomePage } from './pages/Home';
import { McpPage } from './pages/Mcp';
import { ModelsPage } from './pages/Models';
import { PlaygroundPage } from './pages/Playground';
import { ProjectsPage } from './pages/Projects';
import { RunsPage } from './pages/Runs';
import { RunView } from './pages/RunView';
import { SessionsPage } from './pages/Sessions';
import { SettingsPage } from './pages/Settings';
import { TableDetail } from './pages/TableDetail';
import { TablesPage } from './pages/Tables';
import { UsagePage } from './pages/Usage';
import { WorkflowEditor } from './pages/WorkflowEditor';
import { WorkflowsPage } from './pages/Workflows';

function Routes() {
  const { parts } = useRoute();
  const [head, id] = [parts[0]?.split('?')[0] ?? '', parts[1]?.split('?')[0]];
  switch (head) {
    case '':
      return <HomePage />;
    case 'playground':
      return <PlaygroundPage />;
    case 'agents':
      return <AgentsPage />;
    case 'tables':
      return id ? <TableDetail id={id} /> : <TablesPage />;
    case 'workflows':
      return id ? <WorkflowEditor id={id} /> : <WorkflowsPage />;
    case 'projects':
      return <ProjectsPage selected={id} />;
    case 'runs':
      return id ? <RunView id={id} /> : <RunsPage />;
    case 'sessions':
      return <SessionsPage />;
    case 'models':
      return <ModelsPage />;
    case 'usage':
      return <UsagePage />;
    case 'mcp':
      return <McpPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

export function App() {
  const [palette, setPalette] = useState(false);
  useEffect(() => wirePushInvalidation(), []);
  return (
    <div className="flex h-full">
      <Sidebar onCommand={() => setPalette(true)} />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag-region h-[14px] shrink-0" />
        <Routes />
      </main>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
