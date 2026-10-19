import { defineFunction, secret } from '@aws-amplify/backend';

export const workspaceApi = defineFunction({
  name: 'drum-buddy-workspace-api',
  entry: './handler.ts',
  timeoutSeconds: 30,
  environment: {
    REVENUECAT_V2_SECRET_API_KEY: secret('REVENUECAT_V2_SECRET_API_KEY'),
    REVENUECAT_PROJECT_ID: secret('REVENUECAT_PROJECT_ID'),
  },
});
