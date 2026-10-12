import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { setGlobalDispatcher, getGlobalDispatcher, MockAgent } from 'undici';

// Keep unit tests away from the developer's real OS keychain: with the native
// module unavailable, credentials resolve from env vars and the per-test
// credentials file (XDG_CONFIG_HOME) only. Tests that exercise keychain logic
// inject a fake via the resolver's `keychain` override.
vi.mock('@napi-rs/keyring', () => {
  throw new Error('OS keychain disabled in unit tests');
});

// Belt-and-suspenders network isolation:
// - nock blocks node:http/https (kept for legacy fakers; we don't use it directly).
// - undici MockAgent intercepts undici.request (our HTTP client). Tests that need
//   network responses opt in by setting up interceptors; everything unmocked throws.
//
// MockAgent is recreated per test so that interceptors can't leak across tests
// (notably `.times(N)` and `.persist()` previously leaked into adjacent tests).

let priorDispatcher: ReturnType<typeof getGlobalDispatcher>;
let mockAgent: MockAgent;

beforeAll(() => {
  nock.disableNetConnect();
  priorDispatcher = getGlobalDispatcher();
});

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  nock.cleanAll();
  await mockAgent.close();
});

afterAll(() => {
  setGlobalDispatcher(priorDispatcher);
  nock.enableNetConnect();
});

export function getMockAgent(): MockAgent {
  return mockAgent;
}
