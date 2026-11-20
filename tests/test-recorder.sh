#!/usr/bin/env bash
# Self-check for assets/recorder: the engine's unit tests, the template against the scaffold's pages,
# and check-steps.mjs on a built-guide fixture, where each case must pass or fail as stated.
# Needs Node.js only: no cluster or `npm install`. With RECORDER_PLAYWRIGHT=<a node_modules directory that has
# playwright, with Chromium installed> it also runs the browser test; with ffmpeg, the encoder smoke test.
set -euo pipefail
REC="$(cd "$(dirname "$0")/../assets/recorder" && pwd)"
SCAFFOLD="$(cd "$(dirname "$0")/../assets/scaffold" && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
errors=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; errors=1; }

if (cd "$REC" && node test-lib.mjs >/dev/null); then ok "engine unit tests (test-lib.mjs)"; else bad "engine unit tests (test-lib.mjs)"; fi
for f in "$REC"/*.mjs; do node --check "$f" || bad "syntax: $(basename "$f")"; done
ok "every recorder file parses"

# A lab as the skill sets it up: scripts/videos holds the recorder, www/modules the built guide.
# The checkout path has a space in it: default paths must still resolve.
lab="$work/my lab"; mkdir -p "$lab/scripts" "$lab/www/modules"
cp -R "$REC" "$lab/scripts/videos"
if (cd "$lab/scripts/videos" && node test-lib.mjs >/dev/null); then ok "engine unit tests from a path with a space"; else bad "engine unit tests from a path with a space"; fi
page() { # page <name> <video ids...> : one built page; blocks come from stdin, one per line
  local name=$1; shift
  { for v in "$@"; do echo "<video src=\"_images/$v.mp4\" width=\"100%\" controls>"; done
    while IFS= read -r b; do
      echo "<div class=\"listingblock execute\"><div class=\"content\"><pre><code class=\"language-bash hljs\" data-lang=\"bash\">$b</code></pre></div></div>"
    done; } > "$lab/www/modules/$name.html"
}
check() { (cd "$lab/scripts/videos" && if [[ -n "${1:-}" ]]; then export STEPS=$1; fi; node check-steps.mjs >/dev/null 2>&1); }
expect() { # expect pass|fail "<case>" [steps file]
  if check "${3:-}"; then got=pass; else got=fail; fi
  if [[ $got == "$1" ]]; then ok "$2"; else bad "$2 (wanted $1, got $got)"; fi
}

# The template matches the scaffold: the module page's two blocks, the cleanup page's one, no video for cleanup.
n_mod=$(grep -c 'role="execute"' "$SCAFFOLD/content/modules/ROOT/pages/03-module-01-CHANGE-ME.adoc")
n_clean=$(grep -c 'role="execute"' "$SCAFFOLD/content/modules/ROOT/pages/90-cleanup.adoc")
for _ in $(seq "$n_mod"); do echo "oc -n lab-demo get pods"; done | page 03-module-01-CHANGE-ME m1-ex1 m1-ex2
for _ in $(seq "$n_clean"); do echo "CHANGE-ME"; done | page 90-cleanup
expect pass "template steps.mjs against the scaffold's pages"
(cd "$lab/scripts/videos" && node record.mjs list) | grep -qx "m1: m1-ex1 m1-ex2" && ok "record.mjs list works without Playwright installed" || bad "record.mjs list"

# A lab's own steps, then one mistake at a time.
cat > "$lab/scripts/videos/lab-steps.mjs" <<'EOF'
import { T } from "./steps.mjs";
const ex = (id, i, re) => ({ id, title: id, intro: "", run: (s) => s.run(i, { expect: [T(re, "x")] }) });
export const MODULES = {
  m1: { page: "p1", title: "M1", exercises: [ex("m1-ex1", 0, "^demo\\s+Active"),
    { id: "m1-ex2", title: "", intro: "", run: async (s) => { await s.run(1, { expect: [T("^yes$", "x")] }); await s.cam("console"); await s.run(9, {}); } }] },
  cleanup: { page: "p9", title: "Cleanup", video: false, exercises: [ex("cleanup", 0, "deleted$")] },
};
EOF
fixture() {
  printf 'oc get project demo\noc auth can-i create pods -n demo\n' | page p1 m1-ex1 m1-ex2
  echo 'oc delete project demo' | page p9
}
mutate() { sed "$1" "$lab/scripts/videos/lab-steps.mjs" > "$lab/scripts/videos/bad-steps.mjs"; }
fixture
expect pass "a lab's steps; a GUI step stops the check before a block it cannot see" lab-steps.mjs
mutate 's/"\^demo\\\\s+Active"/"get project demo"/'
expect fail "an expectation the pasted command itself satisfies" bad-steps.mjs
mutate 's/ex("m1-ex1", 0,/ex("m1-ex1", 5,/'
expect fail "a step that asks for a block the page does not have" bad-steps.mjs
mutate 's/ex("cleanup", 0,/ex("m1-ex1", 0,/'
expect fail "an exercise id used twice" bad-steps.mjs
mutate 's/page: "p1"/page: "nope"/'
expect fail "a module page that is not in the built guide" bad-steps.mjs
printf 'oc get project demo\noc auth can-i create pods -n demo\n' | page p1 m1-ex1
expect fail "an exercise whose video is not embedded on its page" lab-steps.mjs
printf 'oc get project demo\noc auth can-i create pods -n demo\n' | page p1 m1-ex1 m1-ex2 m1-ex3
expect fail "a page that embeds a video no exercise records" lab-steps.mjs
fixture
{ echo 'oc get project demo'; printf 'echo %03000d\n' 0; } | page p1 m1-ex1 m1-ex2
expect fail "a block too long for the Web Terminal to accept as one paste" lab-steps.mjs

fixture
sed -i.bak 's|_images/m1-ex2.mp4"|_images/m1-ex2.mp4#t=5"|' "$lab/www/modules/p1.html" && rm "$lab/www/modules/p1.html.bak"
expect pass "an embed with a playback offset (video::m1-ex2.mp4[start=5])" lab-steps.mjs
fixture
mutate 's/run: (s) => s.run(i, { expect: \[T(re, "x")\] })/run: async () => { throw new Error("broken exercise"); }/'
expect fail "an exercise whose run() throws (not a GUI step)" bad-steps.mjs
mutate 's/ex("m1-ex1", 0,/ex("m1-ex1", -1,/'
expect fail "a negative block index" bad-steps.mjs
mutate 's/await s.cam("console");/s.take.cut(); await s.cam("console");/'
expect pass "a GUI step that hides its setup with s.take.cut() first" bad-steps.mjs
mutate 's/run: (s) => s.run(i, { expect: \[T(re, "x")\] })/run: (s) => { s.take.cut(); }/'
expect pass "a plain (sync) exercise function" bad-steps.mjs

# record.mjs itself, against a fake Playwright that emulates the Web Terminal: paste, Enter, scripted
# output, prompt. The first exercise's check fails; nothing may be published, nothing after it may run.
fake="$lab/scripts/videos/node_modules/playwright"; mkdir -p "$fake"
echo '{"name":"playwright","type":"module","main":"index.mjs"}' > "$fake/package.json"
cat > "$fake/index.mjs" <<'JS'
const OUT = JSON.parse(process.env.FAKE_OUTPUTS || "{}"), BODY = process.env.FAKE_BODY || "";
const newPage = () => {
  const t = { term: "$ ", input: "", url: "about:blank" };
  return {
    goto: async (u) => { t.url = u; if (process.env.FAKE_NAV_LOG) fs.appendFileSync(process.env.FAKE_NAV_LOG, u + "\n"); },
    url: () => t.url, waitForTimeout: async () => {}, bringToFront: async () => {},
    screenshot: async () => {  // FAKE_SHOT_SECRET: shown only while the screenshot is taken
      if (process.env.FAKE_SHOT_SECRET) { t.shot = process.env.FAKE_SHOT_SECRET; await new Promise((r) => setTimeout(r, 800)); t.shot = ""; }
      return Buffer.from("PNG");
    },
    video: () => ({ path: async () => "/dev/null" }),
    locator: () => { const l = { filter: () => l, getByRole: () => l, isVisible: async () => false, click: async () => {}, count: async () => 0, allInnerTexts: async () => [] }; return l; },
    getByRole: () => ({ isVisible: async () => false, click: async () => {} }),
    keyboard: { press: async () => { const cmd = t.input.trim(); t.input = "";
      t.term = cmd === "clear" ? "$ " : `${t.term}\n${OUT[cmd] ?? ""}\n$ `; } },
    evaluate: async (fn, arg) => {
      const src = String(fn);
      if (src.includes("MutationObserver")) return;                                  // the overlay
      if (src.includes("ClipboardEvent")) { t.input += arg; t.term += arg; return; } // a paste
      if (src.includes("input, textarea")) return `${BODY}\n${t.shot || ""}\n${t.term}`; // PAGE_TEXT
      if (src.includes("__rec.box")) return t.term.split("\n").filter((r) => new RegExp(arg[0].term, "i").test(r)).length;
      if (src.includes("termText")) return t.term;
    },
  };
};
import fs from "node:fs";
export const chromium = { launch: async () => ({ close: async () => {}, newContext: async (opts) => (fs.appendFileSync(process.env.FAKE_CTX_LOG, JSON.stringify(opts) + "\n"), {
  exposeBinding: async () => {}, addInitScript: async () => {}, newPage: async () => newPage(), close: async () => {},
  storageState: async ({ path }) => fs.writeFileSync(path, '{"cookies":[],"origins":[]}') }) }) };
JS
cat > "$lab/scripts/videos/rec-steps.mjs" <<'JS'
import fs from "node:fs";
const spy = (id, text = "ran") => fs.writeFileSync(`${process.env.SPY}/${id}`, text);
export const urls = (domain) => ({ dash: `https://dash.${domain}` });
export const loginTo = JSON.parse(process.env.FAKE_LOGIN_TO || '["dash"]');
export const secretRefs = (_mod) => (process.env.SECRET_NAMES || "").split(",").filter(Boolean).map((n) => ["lab-ns", n, "password", false]);
export const openTerminal = process.env.FAKE_CUSTOM_TERM ? async (_page, cfg) => spy("terminal", JSON.stringify(cfg)) : undefined;
export const MODULES = {
  m1: { page: "p1", title: "M1", exercises: [
    { id: "m1-ex1", title: "E1", intro: "", run: async (s) => {
      if (process.env.FAKE_MODE === "leak") throw new Error(`login failed for ${fs.readFileSync(process.env.LAB_PASSWORD_FILE, "utf8").trim()}`);
      await s.run(0, process.env.FAKE_MODE === "expect"
        ? { expect: [{ re: "^first-line$", label: "x" }, { re: "^demo\\s+Terminating", label: "y" }] }
        : ["pass", "rotate"].includes(process.env.FAKE_MODE) ? { expect: [{ re: "^demo\\s+Terminating", label: "y" }] }
        : { check: [{ re: "^demo\\s+Active$", why: "demo is not Active" }] }); } },
    { id: "m1-ex2", title: "E2", intro: "", run: async (s) => {
      spy("m1-ex2");
      if (process.env.FAKE_MODE === "rotate") {  // the exercise replaces one Secret and creates another
        fs.writeFileSync(`${process.env.SECRET_DIR}/lab-db`, "rotated-value-4567");
        fs.writeFileSync(`${process.env.SECRET_DIR}/lab-new`, "created-value-8901");
      }
      await s.caption("E2", "spied"); } }] },
  cleanup: { page: "p9", title: "Cleanup", video: false, exercises: [{ id: "cleanup", title: "C", intro: "", run: async () => spy("cleanup") }] },
};
JS
cp "$lab/scripts/videos/steps.mjs" "$work/steps.template"
cp "$lab/scripts/videos/rec-steps.mjs" "$lab/scripts/videos/steps.mjs"
fixture
printf 'fixture-password-0123\n' > "$work/pw"; echo '{"cookies":[],"origins":[]}' > "$work/state.json"
record() { # record <debug dir> <page text>: record.mjs all against the fake; stderr to $work/err
  rm -rf "$work/spy" "$work/out" "$work/ctx" && mkdir -p "$work/spy" "$work/out" "$1"
  touch "$work/out/m1-ex1.mp4" "$work/out/m1-ex2.mp4"
  (cd "$lab/scripts/videos" && DOMAIN=apps.example.com STATE="$work/state.json" LAB_PASSWORD_FILE="$work/pw" OUT="$work/out" \
    DEBUG_DIR="$1" SPY="$work/spy" FAKE_BODY="$2" FAKE_CTX_LOG="$work/ctx" FAKE_OUTPUTS='{"oc get project demo":"NAME   STATUS\ndemo   Terminating"}' \
    node record.mjs all >/dev/null 2>"$work/err")
}
if record "$work/dbg-clean" "Project details"; then bad "record.mjs exits 0 after a failed exercise"; else ok "record.mjs exits non-zero after a failed exercise"; fi
if grep -q "FAIL m1-ex1: block 1: demo is not Active" "$work/err"; then ok "the failure names the exercise and the check"; else bad "failure message"; cat "$work/err"; fi
if [[ ! -e "$work/spy/m1-ex2" && ! -e "$work/spy/cleanup" ]]; then ok "no later exercise, and no cleanup, runs after a failure"; else bad "a later exercise or the cleanup ran after a failure"; fi
if [[ -z "$(ls "$work/out")" ]]; then ok "a failed take publishes nothing and leaves no stale video"; else bad "videos left after a failed take: $(ls "$work/out")"; fi
if [[ -s "$work/dbg-clean/m1-ex1.txt" && -s "$work/dbg-clean/m1-ex1.png" ]]; then ok "failure text and screenshot kept when everything scans clean"; else bad "no debug output for a clean failure"; fi
record "$work/dbg-secret" "Token: fixture-password-0123" || true
if [[ -z "$(ls "$work/dbg-secret")" ]]; then ok "no failure screenshot or text when a secret shows anywhere on the page"; else bad "debug output written although the page showed a secret"; fi
if ! grep -q "fixture-password-0123" "$work/err"; then ok "the secret is not printed either"; else bad "the secret reached stderr"; fi
FAKE_SHOT_SECRET="Token: fixture-password-0123" record "$work/dbg-shot" "Project details" || true
if [[ -z "$(ls "$work/dbg-shot")" ]]; then ok "no failure screenshot when a secret shows while it is taken"; else bad "screenshot kept although a secret showed during the capture"; fi
if grep -q '"ignoreHTTPSErrors":false' "$work/ctx" && ! grep -q '"ignoreHTTPSErrors":true' "$work/ctx"; then ok "the browser verifies certificates by default"; else bad "certificate errors ignored by default: $(cat "$work/ctx")"; fi
FAKE_MODE=expect record "$work/dbg-expect" "Project details" || true
if grep -q "FAIL m1-ex1: block 1: expected output /^first-line\$/ is not on screen" "$work/err"; then ok "an expected line missing from the screen fails the exercise"; else bad "missing highlight not reported"; cat "$work/err"; fi
if [[ -z "$(ls "$work/out")" && ! -e "$work/spy/m1-ex2" && ! -e "$work/spy/cleanup" ]]; then ok "after a missing highlight: no video, no later exercise, no cleanup"; else bad "a missing highlight still published or ran on"; fi
FAKE_MODE=leak record "$work/dbg-leak" "Project details" || true
if grep -q "FAIL m1-ex1: (message withheld" "$work/err" && ! grep -q "fixture-password-0123" "$work/err"; then ok "an exercise error that quotes a secret is withheld"; else bad "an exercise error printed a secret"; fi

# The whole path to published videos, with a stub ffmpeg: both exercises pass, both videos appear, the
# cleanup runs last. With ffmpeg failing: no video, no partial file, and no cleanup.
mkdir -p "$work/bin"
printf '#!/bin/sh\n[ -n "$FFMPEG_FAIL" ] && exit 1\nfor a; do out=$a; done\nprintf mp4 > "$out"\n' > "$work/bin/ffmpeg"; chmod +x "$work/bin/ffmpeg"
rc=0; PATH="$work/bin:$PATH" FAKE_MODE=pass record "$work/dbg-pass" "Project details" || rc=$?
if [[ $rc -eq 0 && -s "$work/out/m1-ex1.mp4" && -s "$work/out/m1-ex2.mp4" && -e "$work/spy/cleanup" ]]; then ok "a clean run publishes every video, then runs the cleanup"
else bad "clean run: exit $rc, out: $(ls "$work/out"), spy: $(ls "$work/spy")"; cat "$work/err"; fi
rc=0; PATH="$work/bin:$PATH" FFMPEG_FAIL=1 FAKE_MODE=pass record "$work/dbg-enc" "Project details" || rc=$?
if [[ $rc -ne 0 && -z "$(ls "$work/out")" && ! -e "$work/spy/cleanup" ]] && grep -q "FAIL m1-ex1: encode" "$work/err"; then ok "an encoding failure publishes nothing and stops before the cleanup"
else bad "encode failure: exit $rc, out: $(ls "$work/out"), spy: $(ls "$work/spy")"; fi

# The extension points, through the real entry points. A stub oc serves one Secret from a file.
cat > "$work/bin/oc" <<'SH'
#!/bin/sh
echo "$*" >> "$SECRET_DIR/../oc.log"
f="$SECRET_DIR/$5"; [ -f "$f" ] || { echo "Error from server (NotFound)" >&2; exit 1; }
printf '{"data":{"password":"%s"}}' "$(base64 < "$f" | tr -d '\n')"
SH
chmod +x "$work/bin/oc"
mkdir -p "$work/secrets"; printf 'original-value-0123' > "$work/secrets/lab-db"; rm -f "$work/oc.log"
rc=0; PATH="$work/bin:$PATH" SECRET_DIR="$work/secrets" SECRET_NAMES=lab-db FAKE_CUSTOM_TERM=1 FAKE_MODE=pass record "$work/dbg-ext" "Project details" || rc=$?
if [[ $rc -eq 0 ]] && grep -q '"dash":"https://dash.apps.example.com"' "$work/spy/terminal" && grep -q '"console":"https://console-openshift-console.apps.example.com"' "$work/spy/terminal"; then
  ok "a custom openTerminal gets the page and cfg, with urls() merged in"; else bad "custom openTerminal: exit $rc, $(cat "$work/spy/terminal" 2>/dev/null)"; cat "$work/err"; fi
if grep -q -- "-n lab-ns get secret lab-db -o json" "$work/oc.log"; then ok "secretRefs Secrets are read through oc"; else bad "secretRefs not read: $(cat "$work/oc.log" 2>/dev/null)"; fi
printf 'original-value-0123' > "$work/secrets/lab-db"; rm -f "$work/secrets/lab-new"
rc=0; PATH="$work/bin:$PATH" SECRET_DIR="$work/secrets" SECRET_NAMES=lab-db FAKE_MODE=rotate record "$work/dbg-rot" "Password: original-value-0123" || rc=$?
if [[ $rc -ne 0 && ! -e "$work/out/m1-ex1.mp4" ]] && grep -q "FAIL m1-ex1: secret scan" "$work/err"; then ok "a Secret value shown, then replaced later in the module, still discards the video"
else bad "rotated Secret: exit $rc, out: $(ls "$work/out")"; cat "$work/err"; fi
printf 'original-value-0123' > "$work/secrets/lab-db"; rm -f "$work/secrets/lab-new"
rc=0; PATH="$work/bin:$PATH" SECRET_DIR="$work/secrets" SECRET_NAMES=lab-db,lab-new FAKE_MODE=rotate record "$work/dbg-rot2" "Password: original-value-0123" || rc=$?
if [[ $rc -ne 0 && ! -e "$work/out/m1-ex1.mp4" ]] && grep -q "FAIL m1-ex1: secret scan" "$work/err"; then ok "...also while another required Secret does not exist yet"
else bad "rotated Secret with a missing one: exit $rc, out: $(ls "$work/out")"; cat "$work/err"; fi
login() { (cd "$lab/scripts/videos" && LAB_USER=participant LAB_PASSWORD_FILE="$work/pw" DOMAIN=apps.example.com FAKE_NAV_LOG="$work/nav" FAKE_CTX_LOG="$work/ctx" "$@" node login.mjs "$work/login-state.json" 2>&1); }
rm -f "$work/nav" "$work/login-state.json"
lo=$(login env) || true
if grep -qx "https://console-openshift-console.apps.example.com/" "$work/nav" && grep -qx "https://dash.apps.example.com" "$work/nav" && grep -q "signed in: dash.apps.example.com" <<<"$lo" \
   && [[ "$(stat -f %Lp "$work/login-state.json" 2>/dev/null || stat -c %a "$work/login-state.json")" == 600 ]]; then ok "login.mjs signs in to the console and every loginTo URL, and saves the session mode 600"
else bad "login.mjs: $lo"; fi
if lo=$(login env FAKE_LOGIN_TO='["nope"]'); then bad "login.mjs accepted a loginTo name urls() does not define"
elif grep -q "loginTo names nope" <<<"$lo"; then ok "login.mjs refuses a loginTo name urls() does not define"; else bad "login.mjs loginTo error: $lo"; fi
cp "$work/steps.template" "$lab/scripts/videos/steps.mjs"

# The overlay in a real browser, when Playwright and Chromium are available.
if [[ -n "${RECORDER_PLAYWRIGHT:-}" && -d "$RECORDER_PLAYWRIGHT/playwright" ]]; then
  rm -rf "$lab/scripts/videos/node_modules" && ln -s "$RECORDER_PLAYWRIGHT" "$lab/scripts/videos/node_modules"
  if (cd "$lab/scripts/videos" && node test-browser.mjs >/dev/null); then ok "overlay highlights in a real browser (test-browser.mjs)"; else bad "overlay highlights in a real browser (test-browser.mjs)"; fi
else
  echo "skip browser test: set RECORDER_PLAYWRIGHT to a node_modules directory with playwright"
fi

# encode() with real ffmpeg: two cameras, a sped-up stretch, the held last frame; H.264 at 1280x720.
if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  (cd "$lab/scripts/videos" && node --input-type=module -e '
    import { execFileSync } from "node:child_process";
    import { encode } from "./lib.mjs";
    const d = process.argv[1];
    for (const [n, c] of [["a", "red"], ["b", "blue"]])
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${c}:s=640x360:d=6:r=25`, "-c:v", "libx264", "-pix_fmt", "yuv420p", `${d}/${n}.mp4`]);
    const r = encode([{ cam: "a", from: 0, to: 2, speed: 1 }, { cam: "b", from: 1, to: 5, speed: 4 }, { cam: "a", from: 3, to: 4, speed: 1 }],
      { a: `${d}/a.mp4`, b: `${d}/b.mp4` }, `${d}/out.mp4`);
    console.log(r.seconds);' "$work" > "$work/enc.txt" 2>&1) || true
  probe=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -show_entries format=duration -of csv=p=0 "$work/out.mp4" 2>/dev/null | tr '\n' ' ')
  if [[ $probe =~ ^h264,1280,720\ +([0-9.]+) ]] && awk -v d="${BASH_REMATCH[1]}" -v want="$(cat "$work/enc.txt")" 'BEGIN { exit !(d > want - 0.3 && d < want + 0.3 && want == 6) }'; then
    ok "encode() writes a playable H.264 1280x720 MP4 of the edited length (2 + 4/4 + 1 + 2 s tail)"
  else bad "encode(): got '$probe', reported $(cat "$work/enc.txt")"; fi
else
  echo "skip encode() smoke test: ffmpeg/ffprobe not installed"
fi

exit "$errors"
