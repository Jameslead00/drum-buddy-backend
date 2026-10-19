import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      callbackUrls: ['drumbuddy://callback/'],
      logoutUrls: ['drumbuddy://signout/'],
    },
  },
});
