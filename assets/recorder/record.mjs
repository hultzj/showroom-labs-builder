// Records the lab's step videos as the participant, from the built guide (run `npm run build` first),
// module by module in guide order. Recording runs the lab for real: it is the end-to-end walk.
// Usage: node record.mjs list | all | m1 [m2 ...] [--from m1-ex2] [--to m1-ex3]
// Env: DOMAIN (apps.<cluster>), STATE (session from login.mjs), LAB_PASSWORD_FILE and, optionally,
// KUBEADMIN_PASSWORD_FILE (scanned for; Secrets named in steps.mjs are read through the caller's
// cluster-admin oc login); OUT (default: the guide's images directory); DEBUG_DIR (failure text and
// screenshots, outside the repository); REPO (default: two levels up).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Take, VIEW, browserTls, captureDebug, collectSecrets, encode, executeBlocks, inspect, mkdirp, openTerminal, parseArgs, publish, readSecretWith, rel, runBlock, validBlock, writeDebug, scan, segments, selectRun, failedChecks, sleep, waitFast, withWorkDir } from "./lib.mjs";
import * as STEPS from "./steps.mjs";

const { MODULES } = STEPS;
const { modules: argv, from, to } = parseArgs(process.argv.slice(2));  // --to: the last exercise to record
if (!argv.length || argv[0] === "list") {
  for (const [m, d] of Object.entries(MODULES)) console.log(`${m}: ${d.exercises.map((e) => e.id).join(" ")}`);
  process.exit(0);
}
const todo = argv[0] === "all" ? Object.keys(MODULES) : argv;
for (const m of todo) if (!MODULES[m]) throw new Error(`unknown module ${m}`);
const plan = selectRun(MODULES, todo, from, to);

const domain = process.env.DOMAIN;
if (!domain || !process.env.STATE) throw new Error("DOMAIN and STATE are required");
const repo = process.env.REPO || rel("..", "..");
const out = process.env.OUT || path.join(repo, "content/modules/ROOT/assets/images");
// The console, the built guide, and any web UI the lab's steps open (steps.mjs `urls`).
const cfg = { domain, console: `https://console-openshift-console.${domain}`, www: path.join(repo, "www/modules"),
  ...(STEPS.urls?.(domain) || {}) };
const readSecret = readSecretWith((cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
// Re-read per module: a Secret the lab creates exists only from its module on.
const secretSources = (mod) => ({ passwordFile: process.env.LAB_PASSWORD_FILE, kubeadminFile: process.env.KUBEADMIN_PASSWORD_FILE,
  stateFile: process.env.STATE, secretRefs: STEPS.secretRefs?.(mod) || [] });
const startTerminal = STEPS.openTerminal || ((page) => openTerminal(page, cfg.console));

const { chromium } = await import("playwright");
mkdirp(out);
let failed = 0;
const tls = browserTls();
const browser = await chromium.launch();

async function recordModule(m, exercises, work) {
  const mod = MODULES[m];
  // Every value a scanned Secret had during this module: an exercise may show a value and a later one
  // replace it. Read before the first exercise and after each one (a Secret this module creates may not
  // exist yet: tolerated until publishing, which reads strictly).
  const seen = new Set();
  const secretsSoFar = (strict) => {
    const { values, missing } = collectSecrets(secretSources(mod), readSecret);  // each Secret on its own
    for (const v of values) seen.add(v);
    if (strict && missing.length) throw new Error(`cannot load Secret ${missing[0]} to scan for (oc login as cluster-admin?)`);
    return [...seen];
  };
  secretsSoFar(false);
  const blocks = executeBlocks(cfg.www, mod.page);
  // A failed re-recording must not leave the previous video looking current.
  if (mod.video !== false) for (const ex of exercises) fs.rmSync(path.join(out, `${ex.id}.mp4`), { force: true });
  const context = await browser.newContext({ storageState: process.env.STATE, viewport: VIEW, ...tls,
    recordVideo: { dir: path.join(work, m), size: VIEW } });
  const take = new Take(m, context);
  const pages = {};
  const termText = () => pages.term.evaluate(() => window.__rec?.termText() || "");
  const s = {
    take, cfg,
    async cam(name) {
      if (!pages[name]) pages[name] = await take.page(name);
      take.cam(name);
      await pages[name].bringToFront();
      return pages[name];
    },
    caption: (t, x, k) => take.caption(t, x, k),
    waitFast: (done, why) => waitFast(take, done, { why }),
    // Runs the page's execute block i and highlights each `expect` on screen; any miss fails the exercise.
    async run(i, opts = {}) {
      if (!validBlock(i, blocks.length)) throw new Error(`${mod.page} has execute blocks 0-${blocks.length - 1}; s.run(${i}) is not one`);
      const term = await s.cam("term");
      await runBlock(take, term, blocks[i], opts);
      for (let r = 0; opts.retryUntil && r < (opts.retries || 3) && !new RegExp(opts.retryUntil, "m").test(await termText()); r++) {
        await take.caption("Not ready yet", opts.retryNote || "Waiting 30 seconds, then running the block again.", "warn");
        take.cut(); await sleep(30000); take.normal();
        await runBlock(take, term, blocks[i], opts);
      }
      // the block's last expected line, then the prompt: quiet polling can look idle before the output
      const last = (opts.expect || []).at(-1);
      if (last) await waitFast(take, async () => {
        const t = await termText();
        const rows = t.split("\n").filter((l) => l.trim());
        return new RegExp(last.re, "m").test(t) && /\$\s*$/.test(rows.at(-1) || "");
      }, { why: opts.why || "the output", timeout: 900000 });
      // checks across lines (e.g. two values must be equal), not drawn as a highlight
      const bad = failedChecks(opts.check, await termText());
      if (bad.length) throw new Error(`block ${i + 1}: ${bad.join("; ")}`);
      for (const e of opts.expect || []) {
        const n = await take.box("term", { term: e.re }, e.label, e.kind);
        if (!n) throw new Error(`block ${i + 1}: expected output /${e.re}/ is not on screen`);
        await sleep(2300);
      }
      await sleep(700);
    },
  };
  pages.term = await take.page("term");
  take.cut();
  await startTerminal(pages.term, cfg);
  const done = [];
  let failure = null;
  take.startSampling();
  for (const ex of exercises) {
    take.mark(ex.id);
    take.normal();
    await s.cam("term");
    await take.title(`${mod.title} · ${ex.title}`);
    await take.caption(ex.title, ex.intro);
    await sleep(3200);
    await take.caption(null, null);
    try {
      await ex.run(s);
      await take.clearBoxes();
      await take.caption(ex.title, "Matches the guide's expected result.", "ok");
      await sleep(1800);
      await take.snapshot();
      secretsSoFar(false);
      done.push({ id: ex.id, t: take.marks.at(-1).t });
    } catch (e) {
      failure = { id: ex.id, message: e.message };
      try {
        // Show or keep anything only if this exercise's own scan is clean and the whole page (text and
        // field values, read before and after the screenshot) scans clean too.
        const secrets = secretsSoFar(true);  // fail closed: an unreadable Secret means nothing is shown or kept
        await take.snapshot();
        if (!inspect(take, secrets, ex.id).length) {
          const text = await termText();
          if (!scan([text], secrets).length) console.error(`--- ${ex.id} terminal (last rows) ---\n${text.split("\n").filter((l) => l.trim()).slice(-25).join("\n")}`);
          if (process.env.DEBUG_DIR) {
            mkdirp(process.env.DEBUG_DIR);
            const dbg = await captureDebug(pages.term, (p) => take.read(p));
            // the sampler keeps reading during the capture: anything it saw meanwhile counts too
            if (!inspect(take, secrets, ex.id).length) writeDebug(process.env.DEBUG_DIR, ex.id, dbg.text, dbg.png, secrets);
          }
        }
      } catch { /* the page is gone */ }
      break;
    }
  }
  take.stopSampling();
  const end = Date.now();
  const videos = Object.fromEntries(Object.entries(take.pages).map(([cam, p]) => [cam, p.video()]));
  await context.close();
  const sources = {};
  for (const [cam, v] of Object.entries(videos)) sources[cam] = await v.path();
  let published = true;
  if (mod.video === false) done.forEach((d) => console.log(`ok   ${d.id} (checked, no video)`));
  else published = publish({ take, done, end, out, secrets: secretsSoFar(true),
    enc: (fromT, toT, file) => encode(segments(take, toT, fromT), sources, file) });
  if (!published) failed = 1;
  if (failure) {
    failed = 1;
    // an exercise's error can quote what it saw: print it only if it scans clean
    let said;
    try { said = scan([failure.message], secretsSoFar(true)).length ? "(message withheld: it contains a secret or token)" : failure.message; }
    catch { said = "(message withheld: a Secret to scan for could not be read)"; }
    console.error(`FAIL ${failure.id}: ${said}`);
    return false;
  }
  return published;
}

try {
  await withWorkDir(async (work) => {
    for (const { m, exercises } of plan) { console.log(`== ${m}`); if (!(await recordModule(m, exercises, work))) break; }
  });
} finally {
  await browser.close();
}
process.exit(failed);
