// Offline checks of steps.mjs against the built guide (no cluster, no browser): run before recording
// and in CI after `npm run build`.  node check-steps.mjs
// Env: WWW (built pages; default ../../www/modules), STEPS (steps file; default ./steps.mjs).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GUI_STEP, executeBlocks, guiStub, rel, validBlock } from "./lib.mjs";

const www = process.env.WWW || rel("..", "..", "www", "modules");
const { MODULES } = await import(pathToFileURL(path.resolve(process.env.STEPS || rel("steps.mjs"))).href);
// The console Web Terminal drops a paste of about 3,070 characters or more (measured: 3,050 arrives,
// 3,072 does not), for a participant as for the recorder.
const PASTE_LIMIT = 3000;
const problems = [];
const bad = (m) => problems.push(m);
const ids = new Set();

for (const [m, mod] of Object.entries(MODULES)) {
  const html = path.join(www, `${mod.page}.html`);
  if (!fs.existsSync(html)) { bad(`${m}: ${mod.page}.html is not in ${www} (run npm run build; is page right?)`); continue; }
  const blocks = executeBlocks(www, mod.page);
  blocks.forEach((b, i) => { if (b.length >= PASTE_LIMIT) bad(`${mod.page} block ${i + 1}: ${b.length} characters; the Web Terminal drops pastes this long, split it`); });
  for (const ex of mod.exercises) {
    if (ids.has(ex.id)) bad(`${ex.id}: exercise id used twice`);
    ids.add(ex.id);
    // The terminal steps up to the first GUI step: each block exists, and no expectation is met by the
    // pasted command itself (the terminal shows the command too, so such an expect proves nothing).
    const run = async (i, opts = {}) => {
      if (!validBlock(i, blocks.length)) { bad(`${ex.id}: s.run(${i}) is not one of ${mod.page}'s ${blocks.length} execute blocks (0-based)`); return; }
      for (const x of opts.expect || []) if (new RegExp(x.re, "m").test(blocks[i])) bad(`${ex.id} block ${i + 1}: /${x.re}/ matches the pasted command itself`);
    };
    // A GUI step ends the offline run; any other exception is a broken exercise.
    try { await ex.run(guiStub({ run })); } catch (e) { if (e.message !== GUI_STEP) bad(`${ex.id}: run() threw: ${e.message}`); }  // sync or async
  }
  // Each published exercise is embedded on its page, and the page embeds no video the steps do not make.
  if (mod.video !== false) {
    const embedded = new Set([...fs.readFileSync(html, "utf8").matchAll(/<video src="[^"]*?([^/"#?]+)\.mp4[#?"]/g)].map((x) => x[1]));
    for (const ex of mod.exercises) if (!embedded.has(ex.id)) bad(`${mod.page}: no video::${ex.id}.mp4[] embedded for ${ex.id}`);
    const own = new Set(mod.exercises.map((e) => e.id));
    for (const v of embedded) if (!own.has(v)) bad(`${mod.page}: embeds ${v}.mp4, which no exercise in ${m} records`);
  }
}

if (problems.length) { console.error(problems.map((p) => `check-steps: ${p}`).join("\n")); process.exit(1); }
console.log(`check-steps: OK (${ids.size} exercises in ${Object.keys(MODULES).length} modules)`);
