import type { AppSyncResolverEvent } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';

declare const process: { env: Record<string, string | undefined> };
const randomUUID = () => crypto.randomUUID();
const inviteCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)))
  .map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
Amplify.configure(resourceConfig, libraryOptions);
const db = generateClient<Schema>().models as any;
type Event = AppSyncResolverEvent<Record<string, any>, Record<string, any>>;
type Profile = { id: string; role: 'TEACHER' | 'STUDENT'; displayName: string };
type Group = { id: string; teacherId: string; name: string; inviteCode: string };
type WarmUp = { id: string; groupId: string; teacherId: string; title: string; instructions?: string;
  stepCodes: string[]; bpm: number; durationSeconds: number; active: boolean; createdAt: string };
type Practice = { id: string; userId: string; warmUpId?: string; exerciseId?: string;
  bpm?: number; durationSeconds: number; earnedXp: number; completedAt: string };
function fail(message: string): never { throw new Error(message); }
function input(value: unknown, name: string, max = 120): string {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) fail(`${name} must have 1–${max} characters.`);
  return result;
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) fail(`${name} must be ${min}–${max}.`);
  return Number(value);
}
function valid<T>(result: any): T {
  if (result.errors?.length) fail(result.errors.map((error: any) => error.message).join('; '));
  if (result.data == null) fail('The online service did not return a result.');
  return result.data as T;
}
async function get<T>(model: string, id: string): Promise<T | null> {
  const result = await db[model].get({ id }, { authMode: 'iam' });
  if (result.errors?.length) fail(result.errors.map((error: any) => error.message).join('; '));
  return result.data as T | null;
}
async function list<T>(model: string, filter: any): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;
  do {
    const result = await db[model].list({ filter, limit: 1000, nextToken }, { authMode: 'iam' });
    if (result.errors?.length) fail(result.errors.map((error: any) => error.message).join('; '));
    all.push(...result.data);
    nextToken = result.nextToken ?? undefined;
  } while (nextToken);
  return all;
}
const create = async <T>(model: string, value: any) => valid<T>(await db[model].create(value, { authMode: 'iam' }));
const update = async <T>(model: string, value: any) => valid<T>(await db[model].update(value, { authMode: 'iam' }));
async function person(sub: string): Promise<Profile> {
  const value = await get<Profile>('Profile', sub);
  if (!value) fail('Choose an account type first.');
  return value;
}
async function subscribed(sub: string, role: Profile['role']): Promise<boolean> {
  const key = process.env.REVENUECAT_V2_SECRET_API_KEY;
  const project = process.env.REVENUECAT_PROJECT_ID;
  if (!key || !project) return false;
  try {
    let page: string | undefined;
    do {
      const url = new URL(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(project)}/customers/${encodeURIComponent(sub)}/subscriptions`);
      url.searchParams.set('environment', 'production');
      if (page) url.searchParams.set('starting_after', page);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return false;
      const body = await response.json() as { items?: Array<{ gives_access?: boolean; environment?: string;
        store?: string; entitlements?: { items?: Array<{ lookup_key?: string }> } }>; next_page?: string };
      if (body.items?.some(item => item.gives_access === true && item.environment === 'production'
        && item.store === 'app_store' && item.entitlements?.items?.some(ent => ent.lookup_key === role.toLowerCase()))) return true;
      page = body.next_page;
    } while (page);
  } catch { return false; }
  return false;
}
async function requireSubscription(sub: string, role?: Profile['role']): Promise<Profile> {
  const profile = await person(sub);
  if (role && profile.role !== role) fail('Wrong account type for this action.');
  if (!await subscribed(sub, profile.role)) fail('An active subscription is required.');
  return profile;
}
async function access(groupId: string, sub: string): Promise<Group> {
  const group = await get<Group>('Group', groupId);
  if (!group) fail('Group not found.');
  if (group.teacherId !== sub && !await get('Membership', `${groupId}#${sub}`)) fail('You are not in this group.');
  return group;
}
async function groupView(group: Group, sub: string) {
  const teacher = await person(group.teacherId);
  return { ...group, teacherName: teacher.displayName,
    inviteCode: group.teacherId === sub ? group.inviteCode : '',
    memberCount: (await list('Membership', { groupId: { eq: group.id } })).length };
}
function warmUpView(value: WarmUp) {
  return { id: value.id, groupId: value.groupId, title: value.title,
    instructions: value.instructions ?? '', stepCodes: value.stepCodes,
    bpm: value.bpm, durationSeconds: value.durationSeconds, active: value.active, createdAt: value.createdAt };
}
async function progress(sub: string) {
  const practices = await list<Practice>('Practice', { userId: { eq: sub } });
  const counts: Record<string, number> = {}, tempos: Record<string, number> = {};
  for (const practice of practices) {
    const key = practice.warmUpId ?? practice.exerciseId;
    if (key) { counts[key] = (counts[key] ?? 0) + 1; tempos[key] = Math.max(tempos[key] ?? 0, practice.bpm ?? 0); }
  }
  const lastPracticeAt = practices.map(value => value.completedAt).sort().at(-1) ?? null;
  return { xp: practices.reduce((sum, value) => sum + value.earnedXp, 0), totalSessions: practices.length,
    lastPracticeAt, completionCountsJSON: JSON.stringify(counts), bestTemposJSON: JSON.stringify(tempos) };
}
export const handler = async (event: Event): Promise<unknown> => {
  const sub = (event.identity as { sub?: string } | null)?.sub;
  if (!sub) fail('Sign in to continue.');
  const args = event.arguments;
  switch (event.info.fieldName) {
    case 'getMyProfile': {
      const value = await get<Profile>('Profile', sub);
      return value ? { userId: sub, role: value.role, displayName: value.displayName,
        entitlementActive: await subscribed(sub, value.role) } : null;
    }
    case 'registerProfile': {
      if (await get('Profile', sub)) fail('Account type is already set.');
      if (args.role !== 'TEACHER' && args.role !== 'STUDENT') fail('Invalid account type.');
      const displayName = input(args.displayName, 'Name', 60);
      await create('Profile', { id: sub, role: args.role, displayName });
      return { userId: sub, role: args.role, displayName, entitlementActive: false };
    }
    case 'updateDisplayName': {
      const profile = await person(sub);
      const displayName = input(args.displayName, 'Name', 60);
      await update('Profile', { id: sub, displayName });
      return { userId: sub, role: profile.role, displayName, entitlementActive: await subscribed(sub, profile.role) };
    }
    case 'createGroup': {
      await requireSubscription(sub, 'TEACHER');
      const group = await create<Group>('Group', { id: randomUUID(), teacherId: sub,
        name: input(args.name, 'Group name', 80), inviteCode: inviteCode() });
      return groupView(group, sub);
    }
    case 'joinGroup': {
      await requireSubscription(sub, 'STUDENT');
      const group = (await list<Group>('Group', { inviteCode: { eq: input(args.inviteCode, 'Code', 20).toUpperCase() } }))[0];
      if (!group) fail('Invite code not found.');
      if (!await get('Membership', `${group.id}#${sub}`)) await create('Membership',
        { id: `${group.id}#${sub}`, groupId: group.id, studentId: sub });
      return groupView(group, sub);
    }
    case 'leaveGroup': {
      await requireSubscription(sub, 'STUDENT');
      const id = `${input(args.groupId, 'Group ID')}#${sub}`;
      if (await get('Membership', id)) valid(await db.Membership.delete({ id }, { authMode: 'iam' }));
      return true;
    }
    case 'myGroups': {
      const profile = await requireSubscription(sub);
      const groups = profile.role === 'TEACHER' ? await list<Group>('Group', { teacherId: { eq: sub } })
        : await Promise.all((await list<{ groupId: string }>('Membership', { studentId: { eq: sub } }))
          .map(member => get<Group>('Group', member.groupId)));
      return Promise.all(groups.filter((group): group is Group => !!group).map(group => groupView(group, sub)));
    }
    case 'getGroup': {
      await requireSubscription(sub);
      return groupView(await access(input(args.groupId, 'Group ID'), sub), sub);
    }
    case 'listMembers': {
      await requireSubscription(sub, 'TEACHER');
      const group = await access(input(args.groupId, 'Group ID'), sub);
      if (group.teacherId !== sub) fail('Teacher access required.');
      return Promise.all((await list<{ studentId: string }>('Membership', { groupId: { eq: group.id } }))
        .map(async member => { const value = await person(member.studentId); return {
          userId: member.studentId, role: value.role, displayName: value.displayName,
          entitlementActive: await subscribed(member.studentId, value.role) }; }));
    }
    case 'createWarmUp': {
      await requireSubscription(sub, 'TEACHER');
      const group = await access(input(args.groupId, 'Group ID'), sub);
      if (group.teacherId !== sub) fail('Teacher access required.');
      const codes = args.stepCodes;
      if (!Array.isArray(codes) || !codes.length || codes.length > 32
        || codes.some((code: string) => !['R', 'L', '-', 'R!', 'L!'].includes(code))) fail('Invalid stroke pattern.');
      return warmUpView(await create<WarmUp>('WarmUp', { id: randomUUID(), groupId: group.id, teacherId: sub,
        title: input(args.title, 'Title', 100), instructions: String(args.instructions ?? '').slice(0, 500),
        stepCodes: codes, bpm: integer(args.bpm, 'BPM', 40, 280),
        durationSeconds: integer(args.durationSeconds, 'Duration', 30, 1800), active: true }));
    }
    case 'updateWarmUp': {
      await requireSubscription(sub, 'TEACHER');
      const value = await get<WarmUp>('WarmUp', input(args.warmUpId, 'Warm-up ID'));
      if (!value || value.teacherId !== sub) fail('Warm-up not found.');
      const patch: any = { id: value.id };
      if (args.title != null) patch.title = input(args.title, 'Title', 100);
      if (args.instructions != null) patch.instructions = String(args.instructions).slice(0, 500);
      if (args.stepCodes != null) {
        if (!Array.isArray(args.stepCodes) || !args.stepCodes.length || args.stepCodes.length > 32
          || args.stepCodes.some((code: string) => !['R', 'L', '-', 'R!', 'L!'].includes(code))) fail('Invalid stroke pattern.');
        patch.stepCodes = args.stepCodes;
      }
      if (args.bpm != null) patch.bpm = integer(args.bpm, 'BPM', 40, 280);
      if (args.durationSeconds != null) patch.durationSeconds = integer(args.durationSeconds, 'Duration', 30, 1800);
      if (args.active != null) patch.active = Boolean(args.active);
      return warmUpView(await update<WarmUp>('WarmUp', patch));
    }
    case 'listWarmUps': {
      await requireSubscription(sub);
      const group = await access(input(args.groupId, 'Group ID'), sub);
      return (await list<WarmUp>('WarmUp', { groupId: { eq: group.id } }))
        .filter(value => value.active || group.teacherId === sub).map(warmUpView);
    }
    case 'recordPractice': {
      await requireSubscription(sub);
      const durationSeconds = integer(args.durationSeconds, 'Duration', 30, 1800);
      let warmUpId: string | null = null, exerciseId: string | null = null, groupId: string | null = null;
      if (args.warmUpId) {
        const value = await get<WarmUp>('WarmUp', input(args.warmUpId, 'Warm-up ID'));
        if (!value?.active) fail('Warm-up not found.');
        await access(value.groupId, sub);
        if (durationSeconds < value.durationSeconds) fail('Finish the warm-up before saving.');
        warmUpId = value.id; groupId = value.groupId;
      } else if (args.exerciseId) exerciseId = input(args.exerciseId, 'Exercise ID');
      else fail('Choose a warm-up or exercise.');
      const recent = await list<Practice>('Practice', { userId: { eq: sub } });
      if (recent.some(value => value.warmUpId === warmUpId && value.exerciseId === exerciseId
        && Date.now() - Date.parse(value.completedAt) < 30_000)) fail('Practice already saved.');
      return create('Practice', { id: randomUUID(), userId: sub, groupId, warmUpId, exerciseId,
        bpm: args.bpm == null ? null : integer(args.bpm, 'BPM', 40, 280),
        durationSeconds, earnedXp: warmUpId ? 25 : 50, completedAt: new Date().toISOString() });
    }
    case 'myProgress': await requireSubscription(sub); return progress(sub);
    case 'groupProgress': {
      await requireSubscription(sub, 'TEACHER');
      const group = await access(input(args.groupId, 'Group ID'), sub);
      if (group.teacherId !== sub) fail('Teacher access required.');
      return Promise.all((await list<{ studentId: string }>('Membership', { groupId: { eq: group.id } }))
        .map(async member => { const value = await progress(member.studentId);
          return { userId: member.studentId, displayName: (await person(member.studentId)).displayName,
            xp: value.xp, totalSessions: value.totalSessions, lastPracticeAt: value.lastPracticeAt }; }));
    }
    default: fail('Unknown operation.');
  }
};
