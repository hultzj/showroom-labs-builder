// Logs the participant in once, never on camera, to the OpenShift console and to every web UI in
// steps.mjs `loginTo`, and saves the browser session for the recordings.
// Usage: LAB_USER=<user> LAB_PASSWORD_FILE=<file> DOMAIN=apps.<cluster> [IDP=<provider>] node login.mjs <state.json>
// IDP is the login-page link to pick when the cluster offers several identity providers.
// The session file is a credential: it is written mode 600; keep it outside the repository.
import fs from "node:fs";
import { chromium } from "playwright";
import { signIn } from "./auth.mjs";
import { browserTls, writePrivate } from "./lib.mjs";
import * as STEPS from "./steps.mjs";

const [stateFile] = process.argv.slice(2);
const user = process.env.LAB_USER, domain = process.env.DOMAIN, idp = process.env.IDP;
const password = process.env.LAB_PASSWORD_FILE ? fs.readFileSync(process.env.LAB_PASSWORD_FILE, "utf8").trim() : "";
if (!stateFile || !user || !domain || !password) throw new Error("state file, LAB_USER, DOMAIN and LAB_PASSWORD_FILE are required");

const urls = STEPS.urls?.(domain) || {};
const targets = [`https://console-openshift-console.${domain}/`, ...(STEPS.loginTo || []).map((k) => {
  if (!urls[k]) throw new Error(`loginTo names ${k}, which urls() does not define`);
  return urls[k];
})];

const browser = await chromium.launch();
const context = await browser.newContext({ ...browserTls(), viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

for (const t of targets) { await signIn(page, t, { user, password, idp }); console.log("signed in:", new URL(t).host); }
writePrivate(stateFile, JSON.stringify(await context.storageState()));  // mode 600 before any cookie lands
await browser.close();
