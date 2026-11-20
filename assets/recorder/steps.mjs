// The lab's step videos: one per exercise, recorded module by module in guide order. Every `expect`
// must find its text on screen, or the exercise fails and produces no video: a recording cannot show
// a step that did not give the guide's expected result. Replace the example module with the lab's.
//
// An exercise's run(s) gets:
//   s.run(i, opts)  paste the page's execute block i (0-based, guide order) into the terminal, wait,
//                   then box each opts.expect on screen. opts: expect [T(re, label, kind)], check
//                   [{re|absent|fn, why}] (cross-line checks, not drawn), why (shown while sped up),
//                   retryUntil/retries/retryNote (re-run a block that polls something not ready yet).
//   s.cam(name)     switch the camera to a browser page ("term" is the terminal; any other name opens
//                   a new page, e.g. the console or a product UI from urls()).
//   s.caption(title, html, kind), s.waitFast(doneFn, why), s.take (cut()/normal() hide setup),
//   s.cfg (domain, console, www, and urls()).
import { sleep } from "./lib.mjs";

// An expected line: a regex matched (case-sensitively) against one terminal row, the label drawn beside
// it, and its colour: "ok" (green, the proof), "warn" (amber, an expected failure), "info" (blue, context).
export const T = (re, label, kind = "ok") => ({ re, label, kind });
// For blocks of independent deletes: none of them may print an oc error.
export const NO_OC_ERROR = { absent: "^(Error from server|error: )", why: "a delete failed (oc printed an error)" };
// The participant recording the videos (login.mjs's LAB_USER), as a regex literal: never hardcode it.
export const USER = (process.env.LAB_USER || "participant").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Web UIs the steps open besides the console, by name (s.cfg.<name>). Example:
//   export const urls = (domain) => ({ dashboard: `https://rh-ai.${domain}` });
export const urls = (_domain) => ({});
// Which of those need their own OAuth sign-in in login.mjs (the console always gets one).
export const loginTo = [];
// Secrets whose values must never appear on camera, per module: [namespace, name, key, optional].
// A Secret the lab creates in module N is optional before N and required from N on (fail closed).
export const secretRefs = (_mod) => [];
// The recorder types into the console's Web Terminal, which runs as the logged-in user. If the lab's
// participants use another terminal, export openTerminal(page, cfg) here to open and wait for it.

// --- GUI helpers -------------------------------------------------------------------------------
// A welcome tour or any other PatternFly modal can open seconds after the page: dismiss them off camera.
export async function dismissModals(p, seconds = 15) {
  for (let i = 0; i < seconds; i++) {
    const modal = p.locator(".pf-v6-c-backdrop, .pf-v5-c-backdrop, [role=dialog]").filter({ visible: true }).first();
    if (await modal.count()) {
      const close = modal.getByRole("button", { name: /^Close$|^Skip|^Not now|^Dismiss/i }).first();
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => {}); else await p.keyboard.press("Escape");
    }
    await sleep(1000);
  }
}
// Box the first visible element matching `sel` whose text matches `re`, waiting for it off camera.
export async function boxIn(s, cam, sel, re, label, kind = "ok") {
  const p = s.take.pages[cam];
  const count = () => p.evaluate(([sl, r]) => [...document.querySelectorAll(sl)]
    .filter((e) => e.offsetParent && !e.closest("#__rec") && (!r || new RegExp(r, "i").test(e.innerText || e.value || ""))).length, [sel, re]);
  if (!(await count())) {
    s.take.cut();
    for (let i = 0; i < 45 && !(await count()); i++) await sleep(1000);
    s.take.normal();
  }
  const n = await s.take.box(cam, { sel, re }, label, kind);
  if (!n) throw new Error(`${cam}: nothing matches ${sel} ${re} (${label})`);
  await sleep(2500);
}

// --- The lab -------------------------------------------------------------------------------------
// One entry per module page: page (the .adoc name without extension), title, and one exercise per
// `== Exercise` heading, whose id names its video (`video::<id>.mp4[]` under that heading).
// video: false checks a page without publishing video (the cleanup page, run last by `all`).
export const MODULES = {
  m1: { page: "03-module-01-CHANGE-ME", title: "Module 1 · CHANGE-ME", exercises: [
    { id: "m1-ex1", title: "Exercise 1 · CHANGE-ME", intro: "One sentence: what this exercise shows.",
      run: (s) => s.run(0, { expect: [T("^NAME\\s+READY\\s+STATUS", "CHANGE-ME: the observed result")] }) },
    { id: "m1-ex2", title: "Exercise 2 · CHANGE-ME the negative control", intro: "The deny that proves the allow.",
      run: (s) => s.run(1, { expect: [T("CHANGE-ME", "the specific failure", "warn")] }) },
  ] },
  cleanup: { page: "90-cleanup", title: "Cleanup", video: false, exercises: [
    { id: "cleanup", title: "Cleanup", intro: "Everything the lab created goes.",
      run: (s) => s.run(0, { expect: [T('namespace "CHANGE-ME" deleted', "the lab's namespace is gone")], check: [NO_OC_ERROR] }) },
  ] },
};
