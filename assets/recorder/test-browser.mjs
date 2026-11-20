// The overlay in a real browser (Playwright's Chromium), no cluster: a page shaped like the console's
// Web Terminal (xterm's DOM rows), highlighted through Take as a recording does.  node test-browser.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signIn } from "./auth.mjs";
import { Take, VIEW, typeBlock } from "./lib.mjs";

const rows = ["$ ready=false; echo done", "done", "NAME   STATUS", "demo   Active", "$ "];
const html = `<html><body style="margin:0;font:14px monospace">
  <div class="xterm" style="position:absolute;top:40px;left:20px;width:900px">
    <span class="xterm-char-measure-element" style="position:absolute;visibility:hidden">WWWWWWWWWW</span>
    <div class="xterm-rows">${rows.map((r) => `<div style="height:20px;white-space:pre">${r}</div>`).join("")}</div>
  </div>
  <input id="f" value="typed-secret" style="position:absolute;top:300px;left:20px"><input type="password" value="masked-pw">
</body></html>`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: VIEW });
  const take = new Take("t", context);
  const page = await take.page("term");
  await page.setContent(html);
  const boxes = () => page.evaluate(() => [...document.querySelectorAll("#__rec .box")].map((b) => {
    const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, label: b.innerText };
  }));

  // An expected row is found and boxed, visibly, with its label.
  assert.equal(await take.box("term", { term: "^demo\\s+Active" }, "the proof", "ok"), 1);
  const [b] = await boxes();
  assert.ok(b && b.w > 0 && b.h > 0 && b.label === "the proof", `box: ${JSON.stringify(b)}`);
  // Matching is case-sensitive and per row: "Ready" never appeared as output; the echoed command
  // (ready=false) must not stand in for it. ^done$ boxes the output row, not the command row.
  assert.equal(await take.box("term", { term: "Ready" }, "x"), 0, "the echoed command was taken as output");
  assert.equal(await take.box("term", { term: "^done$" }, "x"), 1);
  assert.equal(await take.box("term", { term: "^gone$" }, "x"), 0, "a row that is not there was boxed");
  await take.clearBoxes();
  assert.deepEqual(await boxes(), []);

  // What the secret scan reads: the terminal rows and visible field values, not masked passwords.
  const text = await take.read(page);
  for (const t of rows.filter((r) => r.trim() !== "$")) assert.ok(text.includes(t), `read() missed row ${t}`);
  assert.ok(text.includes("typed-secret") && !text.includes("masked-pw"), "field values: visible in, masked out");

  // GUI highlights look at the application, never at the recorder's own captions.
  await take.caption("State", "Ready");
  assert.equal(await take.box("term", { sel: "div", re: "^Ready$" }, "proof"), 0, "a caption satisfied a GUI highlight");
  await page.evaluate(() => { const d = document.createElement("div"); d.textContent = "Ready"; document.body.appendChild(d); });
  assert.equal(await take.box("term", { sel: "div", re: "^Ready$" }, "proof"), 1);
  await take.clearBoxes();
  await take.caption(null, null);

  // Captions and the title render into the overlay.
  await take.caption("Exercise 1", "What it shows", "ok");
  await take.title("Module 1 · Exercise 1");
  assert.equal(await page.evaluate(() => document.querySelectorAll("#__rec .cap.ok, #__rec .title").length), 2);
  // typeBlock(): the block reaches xterm's helper textarea as one clipboard paste, then Enter.
  {
    const p = await take.page("paste");
    await p.setContent('<div class="xterm"><div class="xterm-rows"><div>$ </div></div><textarea class="xterm-helper-textarea"></textarea></div>');
    await take.on("paste", () => 0);  // the overlay's termText reads the rows
    await p.evaluate(() => {
      window.events = [];
      const input = document.querySelector("textarea");
      input.addEventListener("paste", (e) => { const t = e.clipboardData.getData("text/plain"); window.events.push(t); document.querySelector(".xterm-rows > div").textContent += t; });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") window.events.push("Enter"); });
    });
    await typeBlock(p, "echo one\necho two");
    assert.deepEqual(await p.evaluate(() => window.events), ["echo one\necho two", "Enter"], "the paste did not reach the terminal as one block");
    await p.evaluate(() => { const ta = document.querySelector("textarea"); ta.replaceWith(ta.cloneNode()); });  // a terminal that ignores pastes
    await assert.rejects(typeBlock(p, "echo three"), /paste did not reach the terminal/);
  }

  // signIn() with the real login-form selectors, against routed fake hosts: the app sends you to OAuth,
  // which lists providers; Keycloak and the OpenShift form post credentials; OpenShift then asks for consent.
  const ok = (u, p) => u === "participant" && p === "pw";
  const doc = (b) => ({ status: 200, contentType: "text/html", body: `<html><body>${b}</body></html>` });
  const route = async (r) => {
    const req = r.request(), url = new URL(req.url()), form = new URLSearchParams(req.postData() || "");
    const cookie = (await req.allHeaders()).cookie || "";
    const at = `${url.host}${url.pathname}`;
    if (at === "app.example/") return r.fulfill(cookie.includes("session=ok") ? doc("<h1>Projects</h1>")
      : doc('<script>location.replace("https://oauth.example/authorize")</script>'));
    if (at === "app.example/cb") return r.fulfill(doc('<script>document.cookie="session=ok; path=/"; location.replace("https://app.example/")</script>'));
    if (at === "oauth.example/authorize" && !url.searchParams.get("idp"))
      return r.fulfill(doc('<a href="https://oauth.example/authorize?idp=keycloak">keycloak</a> <a href="https://oauth.example/authorize?idp=htpasswd">htpasswd</a>'));
    if (url.searchParams.get("idp") === "keycloak") return r.fulfill(doc('<script>location.replace("https://kc.example/login")</script>'));
    if (url.searchParams.get("idp") === "htpasswd") return r.fulfill(doc('<script>location.replace("https://oauth.example/login")</script>'));
    const kcForm = '<form id="kc-form-login" method="post" action="https://kc.example/auth"><input id="username" name="u"><input id="password" type="password" name="p"><input id="kc-login" type="submit" value="Sign in"></form>';
    const ocpForm = '<form method="post" action="https://oauth.example/do"><input id="inputUsername" name="u"><input id="inputPassword" type="password" name="p"><button type="submit">Log in</button></form>';
    if (at === "kc.example/login") return r.fulfill(doc(kcForm));
    if (at === "kc.example/auth") return r.fulfill(ok(form.get("u"), form.get("p")) ? doc('<script>location.replace("https://app.example/cb")</script>') : doc(kcForm));
    if (at === "oauth.example/login") return r.fulfill(doc(ocpForm));
    if (at === "oauth.example/do") return r.fulfill(ok(form.get("u"), form.get("p"))
      ? doc('<form method="post" action="https://oauth.example/approve"><button type="submit">Allow selected permissions</button></form>') : doc(ocpForm));
    if (at === "oauth.example/approve") return r.fulfill(doc('<script>location.replace("https://app.example/cb")</script>'));
    return r.fulfill({ status: 404, body: "" });
  };
  const loginWith = async (idp, password, tries = 20) => {
    const ctx = await browser.newContext();
    await ctx.route("**/*", route);
    const p = await ctx.newPage();
    p.setDefaultTimeout(4000);
    try { await signIn(p, "https://app.example/", { user: "participant", password, idp }, { tries, waitMs: 300 }); return await p.locator("h1").innerText(); }
    finally { await ctx.close(); }
  };
  assert.equal(await loginWith("keycloak", "pw"), "Projects", "the Keycloak form did not sign in");
  assert.equal(await loginWith("htpasswd", "pw"), "Projects", "the OpenShift form and consent did not sign in");
  await assert.rejects(loginWith("keycloak", "wrong", 8), /did not finish/, "a rejected password passed");
} finally {
  await browser.close();
}
console.log("recorder browser test: PASS");
