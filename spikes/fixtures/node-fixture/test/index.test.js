const test = require("node:test");
const assert = require("node:assert/strict");
const { add, toMs } = require("../index.js");

test("add sums two numbers", () => {
  assert.equal(add(2, 2), 4);
});

test("toMs parses a duration with the ms dependency", () => {
  assert.equal(toMs("2 days"), 172800000);
});
