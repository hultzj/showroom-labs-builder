// Unit tests of the recorder engine (lib.mjs): no cluster, no browser, no ffmpeg.  node test-lib.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signIn } from "./auth.mjs";
import { PAGE_TEXT, Take, browserTls, checkOffline, collectSecrets, validBlock, executeBlocks, failedChecks, fitSpeeds, inspect, loadSecrets, parseArgs, publish, readSecretWith, rel, scan, segments, selectRun, writeDebug, MAX_SECONDS, TAIL } from "./lib.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rec-lib-"));
const T = (re, label = "x", kind = "ok") => ({ re, label, kind });

// 1. The secret scan: known secrets (also wrapped across terminal rows), token shapes, clean text.
const pw = "s3cr3t-Passw0rd-xyz";
assert.ok(scan([`echo ${pw}`], [pw]).includes("known secret"));
assert.ok(scan(["s3cr3t-Pass\nw0rd-xyz"], [pw]).includes("known secret"), "a wrapped secret was missed");
for (const shape of ["sha256~ABCDEFGHIJKLMNOPQRSTUVWXYZ", "key sk-ABCDEFGHIJKLMNOPQRSTUV", "sk-oai-ABCDEFGHIJKLMNOPQRSTUV",
  "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij\nAbCdEfGhIjKlMnOpQrStUv.eyJpc3MiOiJrdWJlcm5ldGVz", "-----BEGIN RSA PRIVATE KEY-----"]) {
  assert.ok(scan([shape], []).length, `token shape missed: ${shape.slice(0, 20)}`);
}
assert.deepEqual(scan(["oc get pods -n demo", "sk-oai-ABC… (first ten characters)"], [pw]), []);

// 2. inspect(): an exercise with no text inspected, or a page it could not read, is not clean.
const fake = (texts, unread = 0) => ({ marks: [{ name: "x", t: 1 }], textsBy: { x: new Set(texts) }, unreadBy: { x: unread } });
assert.deepEqual(inspect(fake(["clean"]), [pw], "x"), []);
assert.ok(inspect(fake([]), [pw], "x").includes("no text was inspected"));
assert.ok(inspect(fake(["clean"], 1), [pw], "x").some((h) => /could not read/.test(h)));

// 3. publish(): a scan hit or an encode failure leaves no video (not even the old one) and reports failure.
const out = path.join(tmp, "out"); fs.mkdirSync(out);
const quiet = { log() {}, error() {} };
let encoded = 0;
const enc = (_from, _to, file) => { encoded++; fs.writeFileSync(file, "mp4"); return { seconds: 1, factor: 1 }; };
fs.writeFileSync(path.join(out, "x.mp4"), "old");
assert.equal(publish({ take: fake([`password ${pw}`]), done: [{ id: "x", t: 1 }], end: 2, out, secrets: [pw], enc, log: quiet }), false);
assert.ok(!encoded && !fs.existsSync(path.join(out, "x.mp4")), "a video failing the scan was encoded or kept");
assert.equal(publish({ take: fake(["clean"]), done: [{ id: "x", t: 1 }], end: 2, out, secrets: [pw], enc: () => { throw new Error("ffmpeg"); }, log: quiet }), false);
assert.ok(!fs.existsSync(path.join(out, "x.mp4")));
assert.equal(publish({ take: fake(["clean"]), done: [{ id: "x", t: 1 }], end: 2, out, secrets: [pw], enc, log: quiet }), true);
assert.ok(encoded === 1 && fs.existsSync(path.join(out, "x.mp4")));

// 4. selectRun(): --from/--to select exercises across modules; nothing after --to runs.
const MODS = { m1: { exercises: [{ id: "m1-ex1" }, { id: "m1-ex2" }] }, m2: { exercises: [{ id: "m2-ex1" }] }, cleanup: { exercises: [{ id: "cleanup" }] } };
const ids = (todo, from, to) => selectRun(MODS, todo, from, to).flatMap((x) => x.exercises.map((e) => e.id));
assert.deepEqual(ids(Object.keys(MODS), null, "m1-ex1"), ["m1-ex1"], "--to must stop before the cleanup");
assert.deepEqual(ids(["m1", "m2"], "m1-ex2", null), ["m1-ex2", "m2-ex1"]);
assert.throws(() => ids(["m1"], "m2-ex1", null), /not among/);
assert.throws(() => ids(["m1"], "m1-ex2", "m1-ex1"), /comes after/);

// 5. loadSecrets(): a required Secret that cannot be read stops the recording (fail closed); an
// optional one is scanned for only if it exists; session cookies are secrets too.
const pwFile = path.join(tmp, "pw"); fs.writeFileSync(pwFile, "not-a-real-password\n", { mode: 0o600 });
assert.throws(() => loadSecrets({ passwordFile: pwFile, secretRefs: [["ns", "db", "pw", false]] }, () => ""), /cannot load Secret ns\/db/);
assert.deepEqual(loadSecrets({ passwordFile: pwFile, secretRefs: [["ns", "db", "pw", true]] }, () => ""), ["not-a-real-password"]);
assert.throws(() => loadSecrets({ passwordFile: path.join(tmp, "missing") }, () => ""), /the user's password/);
const state = path.join(tmp, "state.json");
fs.writeFileSync(state, JSON.stringify({ cookies: [{ value: "true" }, { value: "sess-12345" }, { value: "a-long-session-cookie-value" }] }));
const cookieSecrets = loadSecrets({ passwordFile: pwFile, stateFile: state }, () => "");
assert.ok(cookieSecrets.includes("a-long-session-cookie-value") && cookieSecrets.includes("sess-12345"), "a session cookie is not scanned for");
assert.ok(scan(["sess-12345"], cookieSecrets).includes("known secret"));
assert.ok(!cookieSecrets.includes("true"), "a flag cookie would match ordinary page text");

// 5b. collectSecrets(): a required Secret that does not exist yet does not drop the values of others;
// a module that rotates an existing Secret before creating the missing one keeps the original value.
const vals = { existing: "old-value-123456789" };
const refs = [["ns", "existing", "key", false], ["ns", "created", "key", false]];
const seenVals = new Set();
const collect = () => { const r = collectSecrets({ passwordFile: pwFile, secretRefs: refs }, (_ns, n) => vals[n] || ""); r.values.forEach((v) => seenVals.add(v)); return r; };
assert.deepEqual(collect().missing, ["ns/created"]);
vals.existing = "new-value-987654321"; vals.created = "created-value-456789";
assert.deepEqual(collect().missing, []);
assert.ok(seenVals.has("old-value-123456789") && seenVals.has("new-value-987654321"), "the original value of a rotated Secret was lost");

// 6. failedChecks(): re must match, absent must not, fn must return true.
assert.deepEqual(failedChecks([{ re: "^ok$", why: "a" }, { absent: "^Error", why: "b" }, { fn: (t) => t.includes("ok"), why: "c" }], "ok"), []);
assert.deepEqual(failedChecks([{ re: "^ok$", why: "a" }, { absent: "^Error", why: "b" }], "Error from server\nnope"), ["a", "b"]);

// 7. The edit list: cut stretches drop out, segments are relative to each camera's own video, and an
// over-long take speeds up only its already-fast stretches.
const take = { born: { term: 1000, dash: 5000 }, events: [
  { t: 1000, cam: "term", speed: 1 }, { t: 3000, cam: "term", speed: 0 }, { t: 4000, cam: "term", speed: 1 },
  { t: 6000, cam: "dash", speed: 1 }, { t: 7000, cam: "dash", speed: 12 }] };
assert.deepEqual(segments(take, 9000), [
  { cam: "term", from: 0, to: 2, speed: 1 }, { cam: "term", from: 3, to: 5, speed: 1 },
  { cam: "dash", from: 1, to: 2, speed: 1 }, { cam: "dash", from: 2, to: 4, speed: 12 }]);
assert.deepEqual(segments(take, 9000, 6500).map((s) => s.from), [1.5, 2], "an exercise's video starts at its mark");
const long = [{ cam: "term", from: 0, to: 60, speed: 1 }, { cam: "term", from: 60, to: 1260, speed: 12 }];  // 60 s + 100 s
const fit = fitSpeeds(long);
assert.ok(fit.factor > 1 && fit.segs[0].speed === 1, "real-time stretches must keep real time");
assert.ok(Math.abs(fit.segs.reduce((a, s) => a + (s.to - s.from) / s.speed, 0) - (MAX_SECONDS - TAIL)) < 0.01);
assert.throws(() => fitSpeeds([{ cam: "term", from: 0, to: 200, speed: 1 }]), /shorten the step/);

// 8. executeBlocks(): only role="execute" bash blocks, in order, with markup and entities undone.
const www = path.join(tmp, "www"); fs.mkdirSync(www);
fs.writeFileSync(path.join(www, "p.html"), [
  '<div class="listingblock execute"><div class="content"><pre class="highlightjs highlight"><code class="language-bash hljs" data-lang="bash">oc get pods <span class="hljs-string">-n</span> a &amp;&amp; echo &quot;x&quot; &lt; y</code></pre></div></div>',
  '<div class="listingblock"><div class="content"><pre><code class="language-bash hljs" data-lang="bash">not executed</code></pre></div></div>',
  '<div class="listingblock execute"><div class="content"><pre><code class="language-bash hljs" data-lang="bash">oc whoami</code></pre></div></div>'].join("\n"));
assert.deepEqual(executeBlocks(www, "p"), ['oc get pods -n a && echo "x" < y', "oc whoami"]);

// 9. checkOffline(): expectations and checks against captured output; GUI steps stop the run quietly.
const ex = { run: async (s) => { await s.run(0, { expect: [T("^ready$")], check: [{ absent: "^Error", why: "no error" }] }); await s.cam("console"); await s.run(1, { expect: [T("never")] }); } };
assert.deepEqual(await checkOffline(ex, () => "ready"), [], "the GUI step after block 1 must not be reached");
assert.deepEqual(await checkOffline(ex, () => "Error\nnot ready"), ["block 1: /^ready$/", "block 1: no error"]);

// 10. writeDebug(): failure text is written (mode 600) only when it scans clean; unread text is not clean.
const dbg = path.join(tmp, "dbg"); fs.mkdirSync(dbg);
assert.equal(writeDebug(dbg, "a", `token ${pw}`, null, [pw]), false);
assert.equal(writeDebug(dbg, "b", "", null, [pw]), false);
assert.equal(writeDebug(dbg, "c", "clean output", null, [pw]), true);
assert.equal(fs.statSync(path.join(dbg, "c.txt")).mode & 0o777, 0o600);
assert.deepEqual(fs.readdirSync(dbg), ["c.txt"]);

// 11. executeBlocks() stays inside one listing: an execute listing in another language (YAML) does not
// reach into the next, non-execute bash listing.
fs.writeFileSync(path.join(www, "q.html"), [
  '<div class="listingblock execute"><div class="content"><pre><code class="language-yaml hljs" data-lang="yaml">kind: Pod</code></pre></div></div>',
  '<div class="listingblock"><div class="content"><pre><code class="language-bash hljs" data-lang="bash">oc delete project demo</code></pre></div></div>'].join("\n"));
assert.deepEqual(executeBlocks(www, "q"), [], "a non-execute bash listing was picked up");

// 11b. Execute listings with extra roles (class="listingblock execute extra") still count, in order.
fs.writeFileSync(path.join(www, "r.html"), [
  '<div class="listingblock execute extra"><div class="content"><pre><code class="language-bash hljs" data-lang="bash">oc whoami</code></pre></div></div>',
  '<div class="listingblock execute"><div class="content"><pre><code class="language-bash hljs" data-lang="bash">oc delete project demo</code></pre></div></div>'].join("\n"));
assert.deepEqual(executeBlocks(www, "r"), ["oc whoami", "oc delete project demo"], "an execute listing with an extra role was dropped");

// 12. PAGE_TEXT() (run inside the page) includes visible field values, not masked or hidden ones.
const field = (type, value, shown = true) => ({ type, value, offsetParent: shown ? {} : null });
globalThis.document = { body: { innerText: "page text" }, querySelectorAll: () => [field("text", "typed-secret"), field("password", "masked-pw"),
  field("hidden", "csrf"), field("text", "off-screen", false), { type: undefined, value: "textarea-secret", offsetParent: {} }] };
globalThis.window = { __rec: { termText: () => "$ oc whoami" } };
const shown = PAGE_TEXT();
for (const t of ["page text", "$ oc whoami", "typed-secret", "textarea-secret"]) assert.ok(shown.includes(t), `PAGE_TEXT missed ${t}`);
for (const t of ["masked-pw", "csrf", "off-screen"]) assert.ok(!shown.includes(t), `PAGE_TEXT included ${t}`);
assert.ok(scan([shown], ["typed-secret"]).includes("known secret"), "a secret typed into a field passed the scan");
delete globalThis.document; delete globalThis.window;

// 13. parseArgs(): a flag without its value fails instead of meaning "no limit" (which would run the cleanup).
assert.deepEqual(parseArgs(["all", "--to", "m1-ex1"]), { modules: ["all"], from: null, to: "m1-ex1" });
assert.deepEqual(parseArgs(["m1", "m2", "--from", "m1-ex2"]), { modules: ["m1", "m2"], from: "m1-ex2", to: null });
assert.throws(() => parseArgs(["all", "--to"]), /--to needs an exercise id/);
assert.throws(() => parseArgs(["all", "--from", "--to", "m1-ex1"]), /--from needs an exercise id/);
assert.throws(() => parseArgs(["all", "--upto", "m1-ex1"]), /unknown option --upto/);

// 14. readSecretWith(): keys with dots (tls.key) are read as one key; any failure reads as "".
const secretJson = JSON.stringify({ data: { "tls.key": Buffer.from("key-material\n").toString("base64"), plain: Buffer.from("p").toString("base64") } });
const readSecret = readSecretWith((cmd, args) => { assert.equal(cmd, "oc"); assert.deepEqual(args.slice(-2), ["-o", "json"]); return secretJson; });
assert.equal(readSecret("ns", "s", "tls.key"), "key-material");
assert.equal(readSecret("ns", "s", "plain"), "p");
assert.equal(readSecret("ns", "s", "missing"), "");
assert.equal(readSecretWith(() => { throw new Error("forbidden"); })("ns", "s", "plain"), "");

// 15. rel() returns a usable filesystem path (decoded: a checkout path may contain spaces).
assert.ok(fs.existsSync(rel("lib.mjs")), `rel() gave ${rel("lib.mjs")}`);

// 16. signIn() against a fake OpenShift OAuth flow: provider list, Keycloak or OpenShift form, consent.
function fakeOAuth({ providers, form = { keycloak: "kc", htpasswd: "ocp" }, consent = false, password = "pw", start = "idp" }) {
  const st = { screen: start, picked: null, filled: {}, target: null };
  const next = () => { st.screen = consent ? "consent" : "target"; };
  const submit = () => { if (st.filled.pass === password) next(); };  // a wrong password stays on the form
  const loc = (sel) => ({
    isVisible: async () => ({ "#kc-form-login #username": "kc", "#inputUsername": "ocp" })[sel] === st.screen,
    fill: async (v) => { st.filled[/password|inputPassword/i.test(sel) ? "pass" : "user"] = v; },
    first: () => ({ click: async () => submit() }),
    count: async () => (st.screen === "idp" ? providers.length : 0),
    allInnerTexts: async () => providers.map((p) => ` ${p} `),
    nth: (i) => ({ click: async () => { st.picked = providers[i]; st.screen = form[providers[i]]; } }),
  });
  const page = {
    st, goto: async (t) => { st.target = t; }, waitForTimeout: async () => {}, locator: loc,
    getByRole: () => ({ isVisible: async () => st.screen === "consent", click: async () => { st.screen = "target"; } }),
    url: () => (st.screen === "target" ? st.target : st.screen === "kc" ? "https://keycloak.apps.x/realms/sso" : "https://oauth-openshift.apps.x/login"),
  };
  return page;
}
const TARGET = "https://console-openshift-console.apps.x/", who = { user: "participant", password: "pw" }, fast = { tries: 12 };
let fp = fakeOAuth({ providers: ["keycloak", "htpasswd"], consent: true });
await signIn(fp, TARGET, { ...who, idp: "HTPASSWD" }, fast);
assert.deepEqual([fp.st.picked, fp.st.filled.user, fp.st.screen], ["htpasswd", "participant", "target"], "OpenShift form, then consent");
await assert.rejects(signIn(fakeOAuth({ providers: ["keycloak", "htpasswd"] }), TARGET, who, fast), /IDP=: keycloak, htpasswd/);
await assert.rejects(signIn(fakeOAuth({ providers: ["keycloak", "htpasswd"] }), TARGET, { ...who, idp: "ldap" }, fast), /choose an identity provider/);
fp = fakeOAuth({ providers: ["keycloak"] });
await signIn(fp, TARGET, who, fast);
assert.deepEqual([fp.st.picked, fp.st.filled.user, fp.st.screen], ["keycloak", "participant", "target"], "a single provider is picked without IDP");
await assert.rejects(signIn(fakeOAuth({ providers: ["keycloak"], password: "other" }), TARGET, who, fast), /did not finish/, "a failed login must not pass");
// A login form on the target host itself that keeps rejecting the password is not a login.
await assert.rejects(signIn({ goto: async () => {}, url: () => "https://app.example/login", waitForTimeout: async () => {},
  locator: (sel) => ({ isVisible: async () => sel === "#kc-form-login #username", fill: async () => {}, first: () => ({ click: async () => {} }), count: async () => 0 }),
  getByRole: () => ({ isVisible: async () => false }) }, "https://app.example/", who, fast), /did not finish/, "a rejected form on the target host passed");
fp = fakeOAuth({ providers: ["keycloak"], start: "target" });
await signIn(fp, TARGET, who, fast);
assert.deepEqual(fp.st.filled, {}, "an existing session needs no form");

// 17. A screen read that lands after the next exercise has started still counts against the exercise
// that was on screen when it started: its video must not pass the scan.
{
  const pending = [];
  const page = { evaluate: () => new Promise((resolve) => pending.push(resolve)) };
  const take = new Take("m", {});
  take.pages = { term: page };
  take.mark("A");
  take.startSampling(5);
  for (let i = 0; i < 50 && !pending.length; i++) await new Promise((r) => setTimeout(r, 5));
  take.stopSampling();
  const snap = take.snapshot();           // a snapshot started in A, too
  take.mark("B");
  pending.splice(0).forEach((resolve) => resolve(`Token: ${pw}`));
  for (let i = 0; i < 20 && !pending.length; i++) await new Promise((r) => setTimeout(r, 5));
  pending.splice(0).forEach((resolve) => resolve(`Token: ${pw}`));
  await snap;
  assert.ok(inspect(take, [pw], "A").includes("known secret"), "a late sample was filed under the next exercise");
  assert.ok(!take.textsBy.B.size, "exercise B got text it never showed");
}

// 18. Offline runs stop quietly at any use of the step context besides run(): cameras, take, cfg.
for (const run of [async (s) => { s.take.cut(); }, async (s) => { await s.cam("console"); },
  async (s) => { await s.run(0, {}); const url = `${s.cfg.console}/k8s`; return url; }]) {
  assert.deepEqual(await checkOffline({ run }, () => ""), [], String(run));
}

// 18b. Exercises may be plain (sync) functions, as the live runner accepts them.
assert.deepEqual(await checkOffline({ run: (s) => s.take.cut() }, () => ""), []);
assert.deepEqual(await checkOffline({ run: () => {} }, () => ""), []);
assert.deepEqual(await checkOffline({ run: (s) => s.run(0, { expect: [T("^ok$")] }) }, () => "nope"), ["block 1: /^ok$/"]);

// 19. Browser TLS: certificates are verified unless RECORDER_INSECURE_TLS=1, which warns.
const warned = [];
assert.deepEqual(browserTls({}, { error: (m) => warned.push(m) }), { ignoreHTTPSErrors: false });
assert.deepEqual(warned, []);
assert.deepEqual(browserTls({ RECORDER_INSECURE_TLS: "1" }, { error: (m) => warned.push(m) }), { ignoreHTTPSErrors: true });
assert.ok(/intercepted/.test(warned[0]), "insecure TLS must warn");
assert.deepEqual(browserTls({ RECORDER_INSECURE_TLS: "true" }, { error() {} }), { ignoreHTTPSErrors: false }, "only the exact value opts out");

// 20. Block indices: whole numbers within the page's blocks only.
assert.deepEqual([0, 2, -1, 0.5, NaN, 3, "1"].map((i) => validBlock(i, 3)), [true, true, false, false, false, false, false]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("recorder lib test: PASS");
