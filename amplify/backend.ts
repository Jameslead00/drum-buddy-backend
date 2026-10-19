import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

// Amplify Hosting deploys this backend from the main branch.
defineBackend({ auth, data });
