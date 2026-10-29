// Added only on the `probe` branch of arbiter-spike-fixture.
// Fails if the untrusted test process can see anything credential-shaped. Prints NAMES only, never values.
const test = require("node:test");
const assert = require("node:assert/strict");

test("no credential-shaped environment variables are visible", () => {
  const credentialShaped = Object.keys(process.env).filter((name) => /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i.test(name));
  console.log("credential-shaped env var names:", JSON.stringify(credentialShaped));
  assert.deepEqual(credentialShaped, []);
});

test("the canary secret and runner tokens are absent", () => {
  for (const name of ["SPIKE_CANARY", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"]) {
    assert.equal(process.env[name], undefined, `${name} must not be visible to untrusted code`);
  }
});
