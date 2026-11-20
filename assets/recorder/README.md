# Step videos

One video per exercise (`<id>.mp4`, for example `m1-ex1.mp4`), embedded under each exercise heading
with `video::<id>.mp4[width=100%]`, files in `content/modules/ROOT/assets/images/`. Each is recorded
from a real run of the lab as the participant: the recorder pastes the guide's own click-to-run
blocks, taken from the built site, into the OpenShift console's Web Terminal. Captions and highlight
boxes are drawn into the page, waits are sped up (with a badge), setup is cut out, and no video runs
longer than two minutes.

**A recording is a verification.** Every highlight names the guide's expected output. If it is not
on screen, the exercise fails and produces no video, and the run stops there. Re-recording an
exercise deletes its old video first, so a failed take cannot leave a stale one behind. Recording
`all` from a fresh install is the lab's end-to-end test; it ends with the cleanup page (checked, no
video), so **`all` deletes everything the lab built**.

## No credentials on camera

* The participant logs in once, before recording and off camera (`login.mjs`); recordings reuse that
  session. The session file is a credential: keep it outside the repository, mode 600.
* Every text that appears on any recorded page, and a sample of the screen every 250 ms, is checked
  against the participant's and kubeadmin's passwords, the session cookies (values of 8 or more
  characters; shorter ones are flags, not credentials), every Secret named in
  `steps.mjs` `secretRefs`, and token-, key- and private-key-shaped strings. A match discards that video.
* Raw recordings live in a private temporary directory that is removed however the run ends.
* The guide must never print a token or a full key: tokens only inside `$(...)`, keys only as a prefix.

## Requirements

Node.js 20+, `ffmpeg` on the PATH, a cluster-admin `oc` login (to read the Secrets the scan looks for),
the Web Terminal Operator on the cluster, and a participant who logs in with their own account (see
"Terminal" below).

## Record

```bash
cd scripts/videos && npm install && npx playwright install chromium
npm --prefix ../.. run build          # the recorder pastes blocks from the built guide
npm test                              # engine and browser tests, then steps.mjs against the built guide
LAB_USER=<user> LAB_PASSWORD_FILE=<file> DOMAIN=apps.<cluster> node login.mjs <state.json>
LAB_USER=<user> DOMAIN=apps.<cluster> STATE=<state.json> LAB_PASSWORD_FILE=<file> KUBEADMIN_PASSWORD_FILE=<file> \
  node record.mjs all                 # or: list | m1 m2 | m2 --from m2-ex3 | m1 --to m1-ex1
```

Set `IDP=<name>` for `login.mjs` when the login page offers several identity providers. Both scripts
verify TLS certificates, because `login.mjs` types the password and every recording carries the session.
On a test cluster with a self-signed ingress certificate, `RECORDER_INSECURE_TLS=1` skips that check (with
a warning); do not use it on a network you do not trust. Modules build
on each other: record them in order, or from a state where the earlier modules have run. Re-record
after any change to a step's commands or expected results. `DEBUG_DIR=<dir>` keeps the terminal text
and a screenshot of a failed exercise (only if they scan clean), outside the repository.

## Writing steps.mjs

One module per guide page, one exercise per `== Exercise` heading, in guide order. `s.run(i, …)`
pastes the page's execute block `i` (0-based); each `expect` is a regex for one line of the guide's
expected result. Expectations must name the proof, not the command: `check-steps.mjs` fails when an
expectation would match the pasted command itself. Use `check` for cross-line conditions (two values
equal, no `Error from server` in a block of deletes). GUI steps switch camera with `s.cam(name)` and
highlight with `boxIn`; hide setup with `s.take.cut()` and `s.take.normal()`.

`npm test` runs `check-steps.mjs`, which needs no cluster: every page exists, every block a step asks
for exists and stays under the Web Terminal's paste limit (about 3,000 characters), no expectation is
met by its own command, and each page embeds exactly the videos its exercises record. For tests on
captured output, `checkOffline(exercise, (i) => text)` from `lib.mjs` runs an exercise's terminal
steps against text you saved from a real run.

## Terminal

The recorder types into the console's Web Terminal, which runs as the logged-in user. That matches
labs whose participants log in with their own account and use that terminal (the Showroom terminal
turned off). A lab whose participants use the Showroom terminal acts as its ServiceAccount: recording
it through the console would verify a different identity. Such a lab needs its own `openTerminal`
in `steps.mjs`, tested on a live cluster first.
