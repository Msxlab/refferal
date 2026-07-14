'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { accessChangeConfirmation } from '@/lib/privileged-actions';

interface PermDef { key: string; label: string }
interface PermGroup { key: string; label: string; permissions: PermDef[] }
interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}
interface Person {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  tier: 'tenant_owner' | 'tenant_admin' | 'tenant_staff' | 'member' | 'platform_admin';
  role: { id: string; name: string; color: string | null; key: string } | null;
  status: 'active' | 'inactive';
  referralCode: string;
  emailVerified: boolean;
  twoFactor: boolean;
}

const ASSIGNABLE_TIERS = [
  { v: 'tenant_admin', l: 'Admin' },
  { v: 'tenant_staff', l: 'Staff' },
  { v: 'member', l: 'Member' },
];

type PendingAssignment = {
  person: Person;
  patch: { tier?: string; roleId?: string | null };
};

export default function PeopleRoles() {
  const [groups, setGroups] = useState<PermGroup[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [g, r, p] = await Promise.all([
        api.get<PermGroup[]>('/admin/permissions'),
        api.get<RoleRow[]>('/admin/roles'),
        api.get<Person[]>('/admin/people'),
      ]);
      setGroups(g); setRoles(r); setPeople(p);
    } catch (e) { setError(String((e as ApiError).message)); }
  }
  useEffect(() => { reload(); }, []);

  async function assign(assignment: PendingAssignment) {
    setBusy(true);
    try {
      const next = await api.patch<Person[]>(`/admin/people/${assignment.person.membershipId}/role`, assignment.patch);
      setPeople(next);
      setPendingAssignment(null);
      showToast('Role updated');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function removeRole() {
    if (!deleting) return;
    setBusy(true);
    try {
      const next = await api.del<RoleRow[]>(`/admin/roles/${deleting.id}`);
      setRoles(next); setDeleting(null);
      showToast('Role deleted');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !roles) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>People and roles could not be loaded</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!groups || !roles || !people) return <Loading rows={5} />;

  const pendingRole = pendingAssignment?.patch.roleId;
  const assignmentConfirmation = pendingAssignment
    ? accessChangeConfirmation({
        fullName: pendingAssignment.person.fullName,
        currentTier: pendingAssignment.person.tier,
        nextTier: pendingAssignment.patch.tier ?? pendingAssignment.person.tier,
        ...(pendingAssignment.patch.tier === undefined
          ? {
              currentRoleName: pendingAssignment.person.role?.name ?? null,
              nextRoleName: pendingRole ? roles.find((role) => role.id === pendingRole)?.name ?? 'selected role' : null,
            }
          : {}),
      })
    : null;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium">Roles & permissions</h3>
            <p className="text-sm text-muted-foreground">
              Define what each role can do. Owner always has full access.
            </p>
          </div>
          <Button size="sm" type="button" onClick={() => setEditing('new')}>
            <Plus data-icon="inline-start" />
            New role
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-[4px]"
                    style={{ backgroundColor: r.color ?? 'var(--muted)' }}
                  />
                  {r.name}
                </CardTitle>
                <CardDescription>
                  {r.description ?? 'No description provided.'}
                </CardDescription>
                {r.isSystem && (
                  <CardAction>
                    <Badge variant="outline">system</Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="secondary">{r.permissions.length} permissions</Badge>
                <Badge variant="outline">
                  {r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}
                </Badge>
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button variant="outline" size="sm" type="button" onClick={() => setEditing(r)}>
                  <Pencil data-icon="inline-start" />
                  {r.isSystem && r.key === 'owner' ? 'View' : 'Edit'}
                </Button>
                {!r.isSystem && (
                  <Button variant="destructive" size="sm" type="button" onClick={() => setDeleting(r)}>
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>
              Assign a role to each teammate. Owner is managed separately.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{people.length} total</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {people.map((p) => {
                const isOwner = p.tier === 'tenant_owner';
                const isMember = p.tier === 'member';
                return (
                  <TableRow key={p.membershipId}>
                    <TableCell>
                      <div className="font-medium">{p.fullName}</div>
                      <div className="max-w-[260px] truncate text-sm text-muted-foreground">{p.email}</div>
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Badge variant="secondary">Owner</Badge>
                      ) : (
                        <Select
                          value={p.tier}
                          disabled={busy}
                          onValueChange={(tier: string) => {
                            if (tier !== p.tier) {
                              setPendingAssignment({
                                person: p,
                                patch: tier === 'member' ? { tier, roleId: null } : { tier },
                              });
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="min-w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {ASSIGNABLE_TIERS.map((tr) => (
                                <SelectItem key={tr.v} value={tr.v}>{tr.l}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <span className="text-sm text-muted-foreground">Full access</span>
                      ) : isMember ? (
                        <span className="text-sm text-muted-foreground">-</span>
                      ) : (
                        <Select
                          value={p.role?.id ?? 'none'}
                          disabled={busy}
                          onValueChange={(roleId: string) => {
                            const nextRoleId = roleId === 'none' ? null : roleId;
                            if (nextRoleId !== (p.role?.id ?? null)) {
                              setPendingAssignment({ person: p, patch: { roleId: nextRoleId } });
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="min-w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">No role</SelectItem>
                              {roles.filter((r) => r.key !== 'owner').map((r) => (
                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={p.emailVerified ? 'secondary' : 'outline'} title="Email verification">
                          {p.emailVerified ? 'email verified' : 'unverified'}
                        </Badge>
                        {p.twoFactor && (
                          <Badge variant="secondary" title="Two-factor enabled">2FA</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'secondary' : 'outline'}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {editing && (
        <RoleEditor
          groups={groups}
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setRoles(next); setEditing(null); showToast('Role saved'); }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete role"
          message={`Delete "${deleting.name}"? This cannot be undone.`}
          confirmLabel="Delete role"
          danger
          busy={busy}
          onConfirm={removeRole}
          onClose={() => setDeleting(null)}
        />
      )}
      {pendingAssignment && assignmentConfirmation && (
        <Confirm
          title={assignmentConfirmation.title}
          message={assignmentConfirmation.message}
          confirmLabel={assignmentConfirmation.confirmLabel}
          danger={assignmentConfirmation.danger}
          busy={busy}
          onConfirm={() => assign(pendingAssignment)}
          onClose={() => setPendingAssignment(null)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ----------------------------------------- role editor + permission matrix */
const SWATCHES = ['#384BB8', '#6F7ACA', '#0E7A5F', '#9A570F', '#B5364B', '#71809A'];

function RoleEditor({ groups, role, onClose, onSaved }: {
  groups: PermGroup[];
  role: RoleRow | null;
  onClose: () => void;
  onSaved: (roles: RoleRow[]) => void;
}) {
  const locked = role?.isSystem && role.key === 'owner';
  const nameLocked = role?.isSystem ?? false;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [color, setColor] = useState(role?.color ?? SWATCHES[0]);
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const allKeys = useMemo(() => groups.flatMap((g) => g.permissions.map((p) => p.key)), [groups]);

  function toggle(key: string) {
    if (locked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleGroup(g: PermGroup, on: boolean) {
    if (locked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      g.permissions.forEach((p) => (on ? next.add(p.key) : next.delete(p.key)));
      return next;
    });
  }
  function setAll(on: boolean) {
    if (locked) return;
    setPerms(on ? new Set(allKeys) : new Set());
  }

  async function save() {
    if (locked) { onClose(); return; }
    setBusy(true); setErr('');
    const body = { name: name.trim(), description: description.trim() || undefined, color, permissions: [...perms] };
    try {
      const next = role
        ? await api.patch<RoleRow[]>(`/admin/roles/${role.id}`, body)
        : await api.post<RoleRow[]>('/admin/roles', body);
      onSaved(next);
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title={role ? (locked ? 'Owner role' : `Edit ${role.name}`) : 'New role'} onClose={onClose}>
      <div className="flex w-[620px] max-w-[86vw] flex-col gap-4">
        {locked && (
          <Alert>
            <AlertCircle />
            <AlertTitle>Owner role</AlertTitle>
            <AlertDescription>
              The Owner role always holds every permission and cannot be edited.
            </AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <Field>
              <FieldLabel htmlFor="role-name">Role name</FieldLabel>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={nameLocked || locked}
                placeholder="e.g. Regional manager"
              />
            </Field>
            <Field>
              <FieldLabel>Color</FieldLabel>
              <div className="flex gap-2">
              {SWATCHES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={locked}
                  aria-label={`Use color ${s}`}
                  className={cn(color === s && 'ring-2 ring-ring ring-offset-2')}
                  style={{ backgroundColor: s }}
                  onClick={() => setColor(s)}
                />
              ))}
              </div>
              <FieldDescription>Used as the role marker in lists.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="role-description">Description</FieldLabel>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={locked}
              placeholder="What is this role for?"
            />
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-muted-foreground">
            Permissions - {perms.size}/{allKeys.length}
          </div>
          {!locked && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>All</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>None</Button>
            </div>
          )}
        </div>

        <div className="flex max-h-[42vh] flex-col gap-4 overflow-auto pr-1">
          {groups.map((g) => {
            const on = g.permissions.filter((p) => perms.has(p.key)).length;
            const allOn = on === g.permissions.length;
            return (
              <FieldSet key={g.key} className="gap-2">
                <div className="flex items-center justify-between gap-3">
                  <FieldLegend variant="label">{g.label}</FieldLegend>
                  {!locked && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => toggleGroup(g, !allOn)}>
                      {allOn ? 'Clear' : 'Select all'}
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {g.permissions.map((p) => {
                    const checked = perms.has(p.key);
                    const id = `permission-${p.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                    return (
                      <Field
                        key={p.key}
                        orientation="horizontal"
                        data-disabled={locked || undefined}
                        className={cn(
                          'rounded-lg border p-2.5',
                          checked && 'border-primary/30 bg-primary/5',
                        )}
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={locked}
                          onCheckedChange={() => toggle(p.key)}
                        />
                        <FieldLabel htmlFor={id} className="font-normal">
                          {p.label}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </div>
              </FieldSet>
            );
          })}
        </div>

        {err && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Role could not be saved</AlertTitle>
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</Button>
          {!locked && (
            <Button type="button" onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving...' : 'Save role'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
