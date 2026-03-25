// @sourcerer/adapter-hunter — Hunter.io email discovery/verification adapter

export { HunterAdapter } from './hunter-adapter.js';
export { HunterClient, HunterApiError } from './hunter-client.js';
export type {
  HunterEmailResult,
  HunterVerification,
  HunterAccountInfo,
} from './hunter-client.js';
export { buildEmailEvidence, buildVerificationEvidence, buildPiiFields } from './parsers.js';
