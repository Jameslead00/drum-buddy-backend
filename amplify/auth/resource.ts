import { defineAuth, secret } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      signInWithApple: {
        clientId: secret('SIWA_CLIENT_ID'),
        keyId: secret('SIWA_KEY_ID'),
        privateKey: secret('SIWA_PRIVATE_KEY'),
        teamId: secret('SIWA_TEAM_ID'),
        scopes: ['email', 'name'],
      },
      callbackUrls: ['drumbuddy://callback/'],
      logoutUrls: ['drumbuddy://signout/'],
    },
  },
});
