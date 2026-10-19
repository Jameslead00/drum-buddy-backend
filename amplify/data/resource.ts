import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { workspaceApi } from '../functions/workspace-api/resource';

const schema = a.schema({
  Role: a.enum(['TEACHER', 'STUDENT']),

  // These models are accessible to the backend function only. All user-facing
  // reads and writes go through operations below, where membership is checked.
  Profile: a.model({
    id: a.id().required(),
    owner: a.string().required(),
    role: a.ref('Role').required(),
    displayName: a.string().required(),
  }).authorization(allow => [allow.owner()]),
  Group: a.model({
    id: a.id().required(),
    owner: a.string().required(),
    teacherId: a.id().required(),
    name: a.string().required(),
    inviteCode: a.string().required(),
  }).secondaryIndexes(index => [
    index('teacherId'),
    index('inviteCode'),
  ]).authorization(allow => [allow.owner()]),
  Membership: a.model({
    id: a.id().required(),
    owner: a.string().required(),
    groupId: a.id().required(),
    studentId: a.id().required(),
  }).secondaryIndexes(index => [
    index('groupId'),
    index('studentId'),
  ]).authorization(allow => [allow.owner()]),
  WarmUp: a.model({
    id: a.id().required(),
    owner: a.string().required(),
    groupId: a.id().required(),
    teacherId: a.id().required(),
    title: a.string().required(),
    instructions: a.string(),
    stepCodes: a.string().required().array().required(),
    bpm: a.integer().required(),
    durationSeconds: a.integer().required(),
    active: a.boolean().required(),
  }).secondaryIndexes(index => [index('groupId')]).authorization(allow => [allow.owner()]),
  Practice: a.model({
    id: a.id().required(),
    owner: a.string().required(),
    userId: a.id().required(),
    groupId: a.id(),
    warmUpId: a.id(),
    exerciseId: a.string(),
    bpm: a.integer(),
    durationSeconds: a.integer().required(),
    earnedXp: a.integer().required(),
    completedAt: a.datetime().required(),
  }).secondaryIndexes(index => [
    index('userId').sortKeys(['completedAt']),
    index('groupId').sortKeys(['completedAt']),
  ]).authorization(allow => [allow.owner()]),

  ProfileView: a.customType({
    userId: a.id().required(), role: a.ref('Role').required(),
    displayName: a.string().required(), entitlementActive: a.boolean().required(),
  }),
  GroupView: a.customType({
    id: a.id().required(), name: a.string().required(),
    teacherId: a.id().required(), teacherName: a.string().required(),
    inviteCode: a.string(), memberCount: a.integer().required(),
  }),
  WarmUpView: a.customType({
    id: a.id().required(), groupId: a.id().required(),
    title: a.string().required(), instructions: a.string(),
    stepCodes: a.string().required().array().required(),
    bpm: a.integer().required(), durationSeconds: a.integer().required(),
    active: a.boolean().required(), createdAt: a.datetime().required(),
  }),
  PracticeView: a.customType({
    id: a.id().required(), userId: a.id().required(),
    warmUpId: a.id(), exerciseId: a.string(), bpm: a.integer(),
    durationSeconds: a.integer().required(), earnedXp: a.integer().required(),
    completedAt: a.datetime().required(),
  }),
  ProgressView: a.customType({
    xp: a.integer().required(), totalSessions: a.integer().required(),
    lastPracticeAt: a.datetime(), completionCountsJSON: a.string().required(),
    bestTemposJSON: a.string().required(),
  }),
  StudentProgressView: a.customType({
    userId: a.id().required(), displayName: a.string().required(),
    xp: a.integer().required(), totalSessions: a.integer().required(),
    lastPracticeAt: a.datetime(),
  }),

  getMyProfile: a.query().returns(a.ref('ProfileView'))
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  registerProfile: a.mutation().arguments({
    role: a.ref('Role').required(), displayName: a.string().required(),
  }).returns(a.ref('ProfileView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  updateDisplayName: a.mutation().arguments({ displayName: a.string().required() })
    .returns(a.ref('ProfileView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  workspaceCreateGroup: a.mutation().arguments({ name: a.string().required() })
    .returns(a.ref('GroupView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  joinGroup: a.mutation().arguments({ inviteCode: a.string().required() })
    .returns(a.ref('GroupView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  leaveGroup: a.mutation().arguments({ groupId: a.id().required() })
    .returns(a.boolean().required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  myGroups: a.query().returns(a.ref('GroupView').array().required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  listMembers: a.query().arguments({ groupId: a.id().required() })
    .returns(a.ref('ProfileView').array().required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  workspaceCreateWarmUp: a.mutation().arguments({
    groupId: a.id().required(), title: a.string().required(),
    instructions: a.string(), stepCodes: a.string().required().array().required(),
    bpm: a.integer().required(), durationSeconds: a.integer().required(),
  }).returns(a.ref('WarmUpView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  workspaceUpdateWarmUp: a.mutation().arguments({
    warmUpId: a.id().required(), title: a.string(), instructions: a.string(),
    stepCodes: a.string().array(), bpm: a.integer(), durationSeconds: a.integer(),
    active: a.boolean(),
  }).returns(a.ref('WarmUpView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  workspaceListWarmUps: a.query().arguments({ groupId: a.id().required() })
    .returns(a.ref('WarmUpView').array().required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  recordPractice: a.mutation().arguments({
    warmUpId: a.id(), exerciseId: a.string(), bpm: a.integer(),
    durationSeconds: a.integer().required(),
  }).returns(a.ref('PracticeView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  myProgress: a.query().returns(a.ref('ProgressView').required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
  groupProgress: a.query().arguments({ groupId: a.id().required() })
    .returns(a.ref('StudentProgressView').array().required())
    .authorization(allow => [allow.authenticated()]).handler(a.handler.function(workspaceApi)),
}).authorization(allow => [allow.resource(workspaceApi)]);

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
