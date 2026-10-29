// Builds a local git repo with branches pass / fail / probe from node-fixture/. Does NOT push anywhere.
// Usage: node build-fixture-repo.mjs <empty-output-dir>
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node build-fixture-repo.mjs <empty-output-dir>");
mkdirSync(out, { recursive: true });
if (readdirSync(out).length) throw new Error(`${out} is not empty`);

const git = (...args) => execFileSync("git", args, { cwd: out, stdio: "pipe" }).toString().trim();
cpSync(join(here, "node-fixture"), out, { recursive: true, filter: (src) => !src.includes("node_modules") });
git("init", "-b", "pass");
git("config", "user.email", "spike@example.invalid");
git("config", "user.name", "arbiter-spike");
git("add", "-A");
git("commit", "-m", "pass: tiny node project, tests pass");

git("checkout", "-b", "fail");
const testPath = join(out, "test", "index.test.js");
writeFileSync(testPath, readFileSync(testPath, "utf8").replace("assert.equal(add(2, 2), 4);", "assert.equal(add(2, 2), 5); // deliberately false"));
git("commit", "-am", "fail: one deliberately false assertion");

git("checkout", "pass");
git("checkout", "-b", "probe");
writeFileSync(join(out, "test", "no-secrets.test.js"), readFileSync(join(here, "no-secrets.test.js"), "utf8"));
git("add", "-A");
git("commit", "-m", "probe: add the no-secrets test");
git("checkout", "pass");
console.log(git("branch", "-v"));
if (!existsSync(join(out, "package-lock.json"))) throw new Error("package-lock.json missing");
