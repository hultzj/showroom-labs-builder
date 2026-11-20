#!/usr/bin/env bash
# Self-check for scaffold/scripts/check-lab.sh: each case must pass or fail as stated.
set -euo pipefail
SCAFFOLD="$(cd "$(dirname "$0")/../assets/scaffold" && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
errors=0

fresh() {
  rm -rf "$work/lab" && mkdir "$work/lab" && cp -R "$SCAFFOLD/." "$work/lab/"
  # Fill every placeholder, as an author would.
  mv "$work"/lab/content/modules/ROOT/pages/03-module-01-{CHANGE-ME,intro}.adoc
  grep -rlI 'CHANGE-ME' "$work/lab" | grep -v check-lab.sh | while read -r f; do
    sed -i.bak 's/03-module-01-CHANGE-ME/03-module-01-intro/g; s/CHANGE-ME/filled/g' "$f" && rm "$f.bak"
  done
  # Stand-in for `npm run build` output.
  mkdir -p "$work/lab/www/modules" && echo '<code>oc -n netpol-demo get pods</code>' > "$work/lab/www/modules/index.html"
}
expect() { # expect pass|fail "<case>" <args...>
  local want=$1 name=$2; shift 2
  if bash "$work/lab/scripts/check-lab.sh" "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [[ $got == "$want" ]]; then echo "ok   $name"; else echo "FAIL $name (wanted $want, got $got)"; errors=1; fi
}
page="$work/lab/content/modules/ROOT/pages/03-module-01-intro.adoc"

rm -rf "$work/lab" && mkdir "$work/lab" && cp -R "$SCAFFOLD/." "$work/lab/"
expect fail "untouched scaffold fails on CHANGE-ME" --draft

fresh
expect pass "filled scaffold passes in draft mode" --draft
echo '# CHANGE-ME' >> "$work/lab/automation/argocd/values.yaml"
expect fail "one leftover CHANGE-ME fails" --draft

fresh
expect fail "filled scaffold fails strict mode while steps are UNVERIFIED"

fresh
find "$work/lab/content" -name '*.adoc' -exec sed -i.bak '/^\/\/ UNVERIFIED$/d' {} + && find "$work/lab" -name '*.bak' -delete
expect pass "strict mode passes once every step is verified"

fresh
awk 'BEGIN{d=0} /^Expected result/ && !d {d=1; next} {print}' "$page" > "$page.new" && mv "$page.new" "$page"
expect fail "execute block followed by another block without Expected result" --draft

fresh
printf '\n[source,bash,role="execute"]\n----\ntrue\n----\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "execute block at end of file without Expected result" --draft

fresh
printf '\n[source,bash,role=execute]\n----\ntrue\n----\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "unquoted role=execute block without Expected result" --draft

fresh
echo '<code>oc -n {lab_namespace} get pods</code>' > "$work/lab/www/modules/x.html"
expect fail "defined attribute rendered literally in the HTML" --draft

fresh
rm -rf "$work/lab/www"
expect fail "no build output to inspect" --draft

fresh
echo '{{ .Values.missing.key }}' >> "$work/lab/automation/argocd/templates/applications.yaml"
expect fail "chart that does not render" --draft

fresh
sed -i.bak 's/^  namespace: filled$/  namespace: ""/' "$work/lab/automation/argocd/values.yaml" && rm "$work/lab/automation/argocd/values.yaml.bak"
expect fail "empty lab namespace does not render" --draft

fresh
printf '\n[mermaid]\n....\nflowchart LR\n  A --> B\n....\n' >> "$work/lab/content/modules/ROOT/pages/01-overview.adoc"
expect fail "mermaid block (Showroom's builder has no extensions)" --draft

fresh
rm -rf "$work/lab/automation/argocd/components"
expect fail "deleted component still referenced by the parent chart" --draft
printf '\nprereqs:\n  enabled: false\n' >> "$work/lab/automation/argocd/values.yaml"
expect pass "chart with no components once the child is disabled (participant-built lab)" --draft

fresh
printf '\n== Exercise 3: Click through the console\n\nIn the console, open *Workloads*.\n\n== Evidence checkpoint\n' > "$work/lab/tail.adoc"
awk -v tail="$work/lab/tail.adoc" '/^== Evidence checkpoint$/ && !d {while ((getline l < tail) > 0) if (l !~ /Evidence checkpoint/) print l; d=1} {print}' "$page" > "$page.new" && mv "$page.new" "$page"
expect fail "GUI-only exercise without an Expected result" --draft

fresh
echo '"name": "CHANGE-ME-lab"' > "$work/lab/package-lock.json"
expect pass "lockfile generated before the rename is ignored" --draft

fresh
echo "<code>oc get pods -o jsonpath='\\{.items[*]}'</code>" > "$work/lab/www/modules/x.html"
expect fail "backslash left in front of a brace in the HTML" --draft

fresh
printf '\n== Exercise 3: Pick one option\n\n=== Option A\n\nDo A.\n\nExpected result: A done.\n\n== Evidence checkpoint\n' > "$work/lab/tail.adoc"
awk -v tail="$work/lab/tail.adoc" '/^== Evidence checkpoint$/ && !d {while ((getline l < tail) > 0) if (l !~ /Evidence checkpoint/) print l; d=1} {print}' "$page" > "$page.new" && mv "$page.new" "$page"
expect pass "exercise whose Expected result sits in a === subsection" --draft

fresh
python3 - "$page" <<'PY'
import sys; p = sys.argv[1]; s = open(p).read()
open(p, 'w').write(s.replace('----\n(\ntest ', '----\ntest ', 1).replace('echo PASS\n)\n----', 'echo PASS\n----', 1))
PY
expect fail "collapsible assertion that can exit, without a subshell" --draft

fresh
rm -rf "$work/lab/automation/argocd"
expect fail "missing parent chart" --draft

fresh
sed -i.bak 's|app.kubernetes.io/part-of: {{ .Values.partOf }}|app.kubernetes.io/part-of: {{ .Values.partOf \| quote }}|' "$work/lab/automation/argocd/components/lab-prereqs/templates/namespace.yaml"
expect pass "a quoted part-of label value is accepted" --draft

fresh
sed -i.bak '/partOf: {{ .Release.Name | quote }}/d' "$work/lab/automation/argocd/templates/applications.yaml"
expect fail "parent no longer passes the ownership label to the component" --draft

fresh
printf '\nimage::01-console.png[]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "image without alt text" --draft

fresh
printf '\nimage::01-console.png[""]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "image with empty quoted alt text" --draft

fresh
printf '\nimage::01-console.png[alt="",width=600]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "image with empty named alt text" --draft

fresh
printf '\nimage::01-console.png[alt="  ",width=600]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "image whose alt text is only spaces" --draft

fresh
printf '\nimage::01-console.png[width=600]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect fail "image with only named attributes (no alt text)" --draft

fresh
printf '\nimage::01-console.png[width=600,alt="The Projects page"]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect pass "image with named alt text after another attribute" --draft

fresh
printf '\nimage::01-console.png[The Projects page listing your project]\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
expect pass "image with alt text" --draft

fresh
sed -i.bak '/^chartPath:/d' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub without chartPath" --draft

fresh
sed -i.bak 's/^name: .*/name: Not_A_DNS_Name/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub name that is not DNS-1123" --draft

fresh
sed -i.bak 's/^repoURL: .*/repoURL: ""/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub with an empty quoted repoURL" --draft

fresh
sed -i.bak 's/^chartPath: .*/chartPath: ""/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub with an empty quoted chartPath" --draft

fresh
sed -i.bak 's/^chartPath: .*/chartPath: content/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub chartPath without a Chart.yaml" --draft

fresh
sed -i.bak 's/^name: .*/name: "filled-lab"/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect pass "catalog stub with a quoted valid name" --draft

fresh
sed -i.bak 's/^repoURL: .*/repoURL: # TODO URL/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub whose value is only a comment (YAML null)" --draft

fresh
sed -i.bak 's/^revision: .*/revision: null/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub with a null revision" --draft

fresh
sed -i.bak 's/^name: .*/name: filled-lab   /; s/^chartPath: .*/chartPath: "automation\/argocd"   /' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect pass "catalog stub values with trailing spaces" --draft

fresh
sed -i.bak 's/^name: .*/name: "filled-lab/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect fail "catalog stub that is not valid YAML (unmatched quote)" --draft

fresh
sed -i.bak 's/^revision: .*/revision: "null"/' "$work/lab/catalog-stub.yaml" && rm "$work/lab/catalog-stub.yaml.bak"
expect pass "catalog stub whose revision is the quoted string null" --draft

fresh
sed -i.bak '/^== Evidence checkpoint$/d' "$page" && rm "$page.bak"
expect fail "module without Evidence checkpoint" --draft

fresh
printf '= Orphan\n' > "$work/lab/content/modules/ROOT/pages/50-orphan.adoc"
expect fail "page missing from nav" --draft

fresh
rm "$page" && sed -i.bak '/03-module-01-intro/d' "$work"/lab/content/modules/ROOT/{nav.adoc,pages/02-details.adoc} && find "$work/lab" -name '*.bak' -delete
expect fail "no module pages at all" --draft

# translate <lang> <label>: a stand-in translation of every page, as the skill's translation step writes it.
translate() {
  local m="$work/lab/content/modules/$1"
  mkdir -p "$m" && cp -R "$work/lab/content/modules/ROOT/pages" "$work/lab/content/modules/ROOT/nav.adoc" "$m/"
  find "$m/pages" -name '*.adoc' -exec sed -i.bak "s/^Expected result/$2/" {} + && find "$m" -name '*.bak' -delete
  sed -i.bak "s|^  - modules/ROOT/nav.adoc$|&\\n  - modules/$1/nav.adoc|" "$work/lab/content/antora.yml" && rm "$work/lab/content/antora.yml.bak"
}
ja="$work/lab/content/modules/ja"

fresh; translate ja '期待される結果'; translate zh-cn '预期结果'
expect pass "Japanese and Simplified Chinese translations that mirror the English pages" --draft

fresh; translate fr 'Résultat attendu'
sed -i.bak 's/^Résultat attendu/Résultat attendu :/' "$work"/lab/content/modules/fr/pages/*.adoc && find "$work/lab" -name '*.bak' -delete
expect pass "French label with the space before the colon" --draft

fresh; translate it 'Risultato atteso'
expect fail "unsupported language directory" --draft

fresh; translate ja '期待される結果'
sed -i.bak '/modules\/ja\/nav.adoc/d' "$work/lab/content/antora.yml"
expect fail "translation nav not listed in antora.yml" --draft

fresh; translate ja '期待される結果'
rm "$ja/pages/90-cleanup.adoc"
expect fail "English page with no translation" --draft

fresh; translate ja '期待される結果'
printf '= 孤立\n' > "$ja/pages/50-orphan.adoc" && printf '* xref:50-orphan.adoc[孤立]\n' >> "$ja/nav.adoc"
expect fail "translated page with no English page" --draft

fresh; translate ja '期待される結果'
sed -i.bak '/xref:90-cleanup.adoc/d' "$ja/nav.adoc"
expect fail "translated page missing from its nav" --draft

fresh; translate ja '期待される結果'
python3 - "$ja/pages/03-module-01-intro.adoc" <<'PY2'
import re, sys; p = sys.argv[1]; s = open(p).read()
m = re.search(r'role="execute"[^\n]*\n----\n', s); open(p, 'w').write(s[:m.end()] + 'echo translated\n' + s[m.end():])
PY2
expect fail "translated page whose command differs from English" --draft

fresh; translate ja '期待される結果'
sed -i.bak 's/^期待される結果/Expected result/' "$ja/pages/03-module-01-intro.adoc"
expect fail "translated page that kept the English Expected result label" --draft

fresh; translate ja '期待される結果'
sed -i.bak '/^== Evidence checkpoint$/d' "$ja/pages/03-module-01-intro.adoc"
expect fail "translated page with a heading missing" --draft

fresh; translate ja '期待される結果'
printf '\nimage::ROOT:01-console.png[]\n' >> "$ja/pages/91-reference.adoc"
expect fail "translated page with an image without alt text" --draft

fresh; translate ja '期待される結果'
find "$work/lab/content/modules/ROOT" -name '*.adoc' -exec sed -i.bak '/^\/\/ UNVERIFIED$/d' {} + && find "$work/lab" -name '*.bak' -delete
expect fail "strict mode fails while a translation still says UNVERIFIED"

fresh; translate ja '期待される結果'
find "$work/lab/content" -name '*.adoc' -exec sed -i.bak '/^\/\/ UNVERIFIED$/d' {} + && find "$work/lab" -name '*.bak' -delete
expect pass "verified English and Japanese pass strict mode"

fresh
printf '\n[source,bash,role="execute"]\n-----\necho verified\n-----\n\nExpected result: verified.\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
translate ja '期待される結果'
expect pass "translation with a five-hyphen execute block copied verbatim" --draft
sed -i.bak 's/^echo verified$/echo changed/' "$ja/pages/91-reference.adoc"
expect fail "translation whose five-hyphen execute block differs" --draft

fresh; translate ja '期待される結果'
sed -i.bak 's/^\[source,bash,role="execute",subs="attributes+"\]$/[source,bash,role="execute"]/' "$ja/pages/03-module-01-intro.adoc"
expect fail "translation that drops subs=attributes+ from a command" --draft

fresh; translate ja '期待される結果'
sed -i.bak 's/^:navtitle: .*/:navtitle: 翻訳/' "$ja/pages/index.adoc"
expect pass "translation with a translated :navtitle:" --draft
sed -i.bak '/^:navtitle:/a\
:lab_namespace: kube-system
' "$ja/pages/03-module-01-intro.adoc"
expect fail "translation that redefines a lab attribute its commands use" --draft

fresh
printf '\n[source,bash,role="execute"]\n.Command\n----\noc get pods\n----\n\nExpected result: pods.\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
translate ja '期待される結果'
sed -i.bak 's/^\.Command$/.コマンド/' "$ja/pages/91-reference.adoc"
expect pass "translation with a translated block title on a command" --draft
sed -i.bak 's/^oc get pods$/oc delete namespace production/' "$ja/pages/91-reference.adoc"
expect fail "translation whose titled command differs" --draft

fresh
printf '\n:lab_command: oc \\\n  -n netpol-demo get pods\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
translate ja '期待される結果'
expect pass "translation that keeps a continued attribute value" --draft
sed -i.bak 's/netpol-demo get pods/kube-system get pods/' "$ja/pages/91-reference.adoc"
expect fail "translation that changes a continued attribute value" --draft

fresh; translate ja '期待される結果'
printf '\n[%%collapsible]\n====\n[source,bash]\n----\nexit 1\n----\n====\n' >> "$ja/pages/91-reference.adoc"
expect fail "translated assertion that can exit the participant shell" --draft

fresh; translate ja '期待される結果'
printf '\n[mermaid]\n....\nflowchart LR\n  A --> B\n....\n' >> "$ja/pages/91-reference.adoc"
expect fail "translated mermaid block" --draft

fresh; translate ko '예상 결과'; translate es 'Resultado esperado'; translate de 'Erwartetes Ergebnis'
expect pass "Korean, Spanish and German translations that mirror the English pages" --draft

fresh; translate ja '期待される結果'
sed -i.bak 's|^  - modules/ja/nav.adoc$|  - "modules/ja/nav.adoc"  # Japanese|' "$work/lab/content/antora.yml"
expect pass "quoted, commented nav entry for a translation" --draft

fresh
printf '\n[source,bash,role="execute"]\n-----\ncat <<EOF > example.adoc\n[source,bash,role="execute"]\n----\ntrue\n----\nEOF\noc get pods\n-----\n\nExpected result: pods.\n' >> "$work/lab/content/modules/ROOT/pages/91-reference.adoc"
translate ja '期待される結果'
# The Expected-result check (not under test here) also trips on this heredoc, so assert on the parity message.
differs() { local out; out=$(bash "$work/lab/scripts/check-lab.sh" --draft 2>&1) || true; grep -q 'ja/pages/91-reference.adoc: execute blocks differ' <<<"$out"; }
if ! differs; then echo "ok   translation of a command whose heredoc contains AsciiDoc"; else echo "FAIL translation of a command whose heredoc contains AsciiDoc"; errors=1; fi
sed -i.bak 's/^oc get pods$/oc delete namespace production/' "$ja/pages/91-reference.adoc"
if differs; then echo "ok   translation that changes a command after a heredoc containing AsciiDoc"; else echo "FAIL translation that changes a command after a heredoc containing AsciiDoc"; errors=1; fi

# Step videos: every <video src> in the built site must resolve (references/videos.md).
video() { mkdir -p "$(dirname "$work/lab/www/modules/$1")" && echo "<video src=\"$2\" width=\"100%\" controls>" > "$work/lab/www/modules/$1"; }
fresh
mkdir -p "$work/lab/www/modules/_images" && touch "$work/lab/www/modules/_images/m1-ex1.mp4"
video 03-module-01-intro.html _images/m1-ex1.mp4
expect pass "embedded video that is in the built site" --draft
video ja/03-module-01-intro.html ../_images/m1-ex1.mp4
expect pass "translation embedding the English video by relative path" --draft
video ja/03-module-01-intro.html _images/m1-ex1.mp4
expect fail "translation pointing at its own empty _images" --draft
video ja/03-module-01-intro.html ROOT:m1-ex1.mp4
expect fail "video target written as a resource ID (Antora leaves it unresolved)" --draft
fresh
video 03-module-01-intro.html _images/m1-ex2.mp4
expect fail "embedded video never recorded" --draft
fresh
video 03-module-01-intro.html https://example.com/m1-ex1.mp4
expect pass "remote video is not checked" --draft
fresh
mkdir -p "$work/lab/www/modules/_images" && touch "$work/lab/www/modules/_images/m1-ex1.mp4"
video 03-module-01-intro.html "_images/m1-ex1.mp4#t=5"
expect pass "video with a playback offset (video::m1-ex1.mp4[start=5])" --draft
video 03-module-01-intro.html "_images/m1-ex9.mp4#t=5"
expect fail "missing video with a playback offset" --draft
touch "$work/lab/www/modules/_images/exercise one.mp4"
video 03-module-01-intro.html "_images/exercise one.mp4"
expect pass "video whose file name has a space" --draft

# A lab with the recorder: check-lab runs its check-steps.mjs against the built guide.
built() { # built <page> <video ids...>: blocks from stdin, one per line
  local name=$1; shift
  { for v in "$@"; do echo "<video src=\"_images/$v.mp4\">"; done
    while IFS= read -r b; do echo "<div class=\"listingblock execute\"><div class=\"content\"><pre><code class=\"language-bash hljs\" data-lang=\"bash\">$b</code></pre></div></div>"; done
  } > "$work/lab/www/modules/$name.html"
}
fresh
cp -R "$(dirname "$SCAFFOLD")/recorder" "$work/lab/scripts/videos"
sed -i.bak 's/CHANGE-ME/intro/g' "$work/lab/scripts/videos/steps.mjs" && rm "$work/lab/scripts/videos/steps.mjs.bak"
expect fail "recorder steps whose pages are not built" --draft
mkdir -p "$work/lab/www/modules/_images" && touch "$work/lab/www/modules/_images/m1-ex1.mp4" "$work/lab/www/modules/_images/m1-ex2.mp4"
printf 'oc -n lab-demo get pods\noc -n lab-demo get pods\n' | built 03-module-01-intro m1-ex1 m1-ex2
echo 'oc delete namespace lab-demo' | built 90-cleanup
expect pass "recorder steps that match the built guide" --draft
printf 'oc -n lab-demo get pods\n' | built 03-module-01-intro m1-ex1 m1-ex2
expect fail "recorder step asking for a block the guide no longer has" --draft

exit "$errors"
