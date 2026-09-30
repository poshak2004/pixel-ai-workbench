import { useMemo } from 'react';
import { Page } from '../components/layout/Page';
import { Card, Empty, PageHeader, SectionTitle, Stamp, StatusDot, Badge } from '../components/ui/display';
import { fmtTime } from '../lib/format';
import { navigate } from '../lib/router';
import { useQuery } from '../lib/store';

/** Sessions: runs grouped by project and working day, so a stretch of work reads as one story. */
export function SessionsPage() {
  const runs = useQuery('runs.list', { limit: 500 });
  const projects = useQuery('projects.list');
  const groups = useMemo(() => {
    const names = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
    const m = new Map<string, { title: string; day: string; runs: NonNullable<typeof runs.data> }>();
    for (const r of runs.data ?? []) {
      const day = new Date(r.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const key = `${r.projectId ?? 'none'}|${day}`;
      const g = m.get(key) ?? { title: r.projectId ? (names.get(r.projectId) ?? 'Project') : 'No project', day, runs: [] };
      g.runs.push(r);
      m.set(key, g);
    }
    return [...m.values()];
  }, [runs.data, projects.data]);

  return (
    <Page>
      <PageHeader kicker="Continuity" title="Sessions">
        A session is a stretch of work on one project. Runs are grouped by project and day; every run can be replayed or branched from its snapshot.
      </PageHeader>
      {groups.length === 0 ? <Empty title="No sessions yet">Sessions appear as you run tables, agents and workflows.</Empty> : null}
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={`${g.title}${g.day}`}>
            <SectionTitle right={<span className="font-mono text-[10.5px] text-ink-3">{g.runs.length} run(s)</span>}>
              {g.title} · {g.day}
            </SectionTitle>
            <Card className="relative pl-4">
              <div className="absolute top-3 bottom-3 left-[22px] w-px bg-line" />
              {g.runs.map((r) => (
                <button key={r.id} onClick={() => navigate(`/runs/${r.id}`)} className="relative flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-card-2">
                  <StatusDot status={r.status} className="relative z-10" />
                  <span className="w-14 font-mono text-[10.5px] text-ink-3">{fmtTime(r.createdAt)}</span>
                  <Badge>{r.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{r.task}</span>
                  {r.parentRunId ? <Badge tone="lav">branch</Badge> : null}
                  {r.outcome ? <Stamp value={r.outcome.split(':')[0]!} size="sm" /> : null}
                </button>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </Page>
  );
}
