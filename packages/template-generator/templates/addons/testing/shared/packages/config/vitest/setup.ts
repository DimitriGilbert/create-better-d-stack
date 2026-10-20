// Tests must not hit the live network. Any code path that needs fetch should
// stub it in the test that exercises it.
const blockedFetch = () => {
  throw new Error("TEST FORBIDS LIVE NETWORK — stub fetch in the test that needs it");
};

globalThis.fetch = blockedFetch as typeof fetch;
