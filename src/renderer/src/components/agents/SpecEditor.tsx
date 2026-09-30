import { useQuery } from '../../lib/store';
import type { AgentSpec } from '../../lib/types';
import { Field, Input, Select, Textarea } from '../ui/primitives';
import { Checkbox } from '../ui/primitives';
import { SectionTitle } from '../ui/display';
import { ConstitutionView } from './ConstitutionView';
import { ModelSelect } from './ModelSelect';
import { PermissionsEditor } from './PermissionsEditor';

/** Edits an agent spec: Role + Model + rules + tools + permissions. Role and model are independent. */
export function SpecEditor({ value, onChange }: { value: AgentSpec; onChange: (v: AgentSpec) => void }) {
  const roles = useQuery('roles.list');
  const tools = useQuery('tools.list');
  const role = roles.data?.find((r) => r.id === value.roleId);
  const set = <K extends keyof AgentSpec>(k: K, v: AgentSpec[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={value.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
        </Field>
        <Field label="Role (behaviour)">
          <Select value={value.roleId} onChange={(e) => set('roleId', e.target.value)}>
            {(roles.data ?? []).filter((r) => r.id !== 'role_operator').map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.builtIn ? '' : ' (custom)'}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Model (intelligence)" hint="Any discovered model. Swapping it never changes the role.">
        <ModelSelect value={value.model} onChange={(m) => set('model', m)} />
      </Field>
      {role ? <ConstitutionView role={role} compact /> : null}
      <Field label="Objective">
        <Input value={value.objective} onChange={(e) => set('objective', e.target.value)} placeholder="Optional focus for this seat" />
      </Field>
      <Field label="Agent instructions" hint="One per line. Lowest precedence — cannot override the constitution or governance.">
        <Textarea value={value.systemRules.join('\n')} onChange={(e) => set('systemRules', e.target.value.split('\n').filter((l, i, a) => l.trim() || i < a.length - 1))} rows={3} />
      </Field>
      <div>
        <SectionTitle>Tools offered</SectionTitle>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {(tools.data ?? []).map((t) => (
            <Checkbox
              key={t.name}
              checked={value.allowedTools.includes(t.name)}
              onChange={(on) => set('allowedTools', on ? [...value.allowedTools, t.name] : value.allowedTools.filter((x) => x !== t.name))}
              label={
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[11.5px]">{t.name}</span>
                  <span className="font-mono text-[10px] text-ink-3">{t.actionKind}</span>
                </span>
              }
            />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">Offering a tool never grants it. Each call is checked against permissions, the constitution and governance.</p>
      </div>
      <div>
        <SectionTitle>Environment permissions</SectionTitle>
        <PermissionsEditor value={value.permissions} onChange={(p) => set('permissions', p)} />
        <p className="mt-1.5 text-[11px] text-ink-3">Effective access is the intersection with the project's ceiling. * requires approval per action.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Memory">
          <Select value={value.memoryPolicy} onChange={(e) => set('memoryPolicy', e.target.value as AgentSpec['memoryPolicy'])}>
            <option value="none">None</option>
            <option value="run">This run</option>
            <option value="project">Project</option>
          </Select>
        </Field>
        <Field label="Max output tokens">
          <Input type="number" min={256} max={128000} value={value.maxOutputTokens} onChange={(e) => set('maxOutputTokens', Math.max(256, Number(e.target.value) || 4096))} />
        </Field>
      </div>
    </div>
  );
}

export function defaultSpec(model: { providerId: string; modelId: string } | null, roleId = 'role_engineer', name = 'New agent'): AgentSpec {
  return {
    name,
    roleId,
    objective: '',
    model: model ?? { providerId: '', modelId: '' },
    systemRules: [],
    allowedTools: [],
    permissions: { filesystem: 'project_read', terminal: 'denied', git: 'read', browser: 'denied', network: 'denied', system: 'denied', mcp: 'denied' },
    memoryPolicy: 'run',
    maxOutputTokens: 4096,
  };
}
