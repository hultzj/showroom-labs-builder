# Step videos

Optional. Add videos only when the user asks for them. Each exercise gets a video of itself, run for
real as the participant and embedded under its heading. The recorder in `assets/recorder/` produces
them. It refuses to publish a video whose step did not show the guide's expected result, so a full
recording is also the lab's end-to-end test.

## When

After the live verification pass (`verification.md`): the steps and their expected results must be
final, because any change to a step's commands or expected results means re-recording it. Recording
`all` ends with the cleanup page and deletes what the lab built, so do it on a test cluster, from a
fresh install.

**Terminal.** The recorder types into the OpenShift console's Web Terminal, which runs as the
logged-in user. That fits labs whose participant logs in with their own account and uses that
terminal (the Showroom terminal off: shared or cluster-scoped labs, `environments.md`). In a lab
whose participant acts as the Showroom terminal's ServiceAccount, a console recording would verify a
different identity. Do not record such a lab through the console. It needs its own `openTerminal`
in `steps.mjs`, built and tested on a live cluster first. Tell the user before starting.

## Set up

```bash
cp -R <this skill>/assets/recorder scripts/videos
```

Then write `scripts/videos/steps.mjs`: one module per guide page, one exercise per `== Exercise`
heading, in guide order (the file's header documents the API). For each exercise:

- `s.run(i, { expect: [T(re, label, kind)] })` pastes the page's execute block `i` (0-based) and
  boxes each expected line on screen. Take each `re` from the line the guide's `Expected result:`
  names, as observed live. Expect the proof, not the command: `check-steps.mjs` rejects an
  expectation the pasted command would satisfy by itself.
- Use `check` for cross-line conditions (two values equal), and `NO_OC_ERROR` on blocks of deletes.
- GUI steps: `s.cam("console")` or a name from `urls()`, then the same clicks the guide numbers, with
  `boxIn` on each control. Hide waits and setup with `s.take.cut()` and `s.take.normal()`.
- Use `USER` for the participant's name; never hardcode an account.
- `secretRefs(mod)`: every Secret the lab creates whose value must never be on camera, required
  from the module that creates it.

Embed each video under its exercise heading, before the steps:

```asciidoc
== Exercise 1: Deny traffic by default

.Video: this exercise on the test cluster, run as a participant (waits sped up)
video::m1-ex1.mp4[width=100%]
```

Translated pages reuse the English videos: write `video::../../_images/m1-ex1.mp4[width=100%]`.
Antora resolves `ROOT:` resource IDs for images but not for videos (verified with Antora 3.2.0). A
plain target points at the translation's own `_images/`, which has no videos.

## Check, record, commit

```bash
cd scripts/videos && npm install && npx playwright install chromium
npm --prefix ../.. run build && npm test     # engine and browser tests, then steps.mjs against the guide
LAB_USER=<user> LAB_PASSWORD_FILE=<file> DOMAIN=apps.<cluster> node login.mjs <state.json>
LAB_USER=<user> DOMAIN=apps.<cluster> STATE=<state.json> LAB_PASSWORD_FILE=<file> \
  KUBEADMIN_PASSWORD_FILE=<file> node record.mjs all
```

- Keep the password files and `<state.json>` outside the repository, mode 600. Never print them or
  pass them on a command line.
- TLS certificates are verified. Only for a test cluster with a self-signed ingress certificate, set
  `RECORDER_INSECURE_TLS=1`; the password and session then cross an unverified connection.
- A failed exercise prints the terminal's last rows (only if they scan clean) and stops the run.
  Fix the guide or the step, rebuild, and resume with `node record.mjs <module> --from <id>` from a
  state where the earlier steps have run.
- Rebuild before the release check (`npm run build`): the recorder writes into the guide's sources,
  and `check-lab.sh` checks the built site. It runs `check-steps.mjs` and fails on any `<video src>`
  that does not resolve, so a missing recording or a broken translation target blocks release.
- Commit the MP4s with the pages that embed them. Each is at most two minutes and typically 1–5 MB.

## What the recorder guarantees

- No video of a step that failed: every `expect` must be on screen, or nothing is published.
- No credentials on camera: every text shown, and the screen every 250 ms, is scanned for the
  passwords, session cookies, `secretRefs` values and token or key shapes; a hit discards the video.
- No stale videos: re-recording deletes the old file first; raw recordings never outlive the run.
