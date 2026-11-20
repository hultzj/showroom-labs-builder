# Translations

English is the lab's source language and is always present. A lab can add any
of these translations:

| Language | Module directory | Sidebar label | `Expected result` label |
|---|---|---|---|
| Japanese | `ja` | 日本語 | 期待される結果 |
| Korean | `ko` | 한국어 | 예상 결과 |
| Simplified Chinese | `zh-cn` | 简体中文 | 预期结果 |
| Spanish | `es` | Español | Resultado esperado |
| German | `de` | Deutsch | Erwartetes Ergebnis |
| French | `fr` | Français | Résultat attendu |

`check-lab.sh` rejects any other directory under `content/modules/`. Use the
labels exactly as shown; the parity check counts them.

## Layout

Each translation is one more Antora module in the same component, so it shares
`content/antora.yml` and every attribute Showroom injects (`guid`,
`cluster_domain`, the lab's own attributes):

```text
content/antora.yml                  # nav: lists modules/ROOT/nav.adoc first, then each translation's nav
content/modules/ROOT/               # English, the source
content/modules/ja/nav.adoc
content/modules/ja/pages/*.adoc     # same file names as ROOT/pages
```

English stays at `/modules/`. Japanese is at `/modules/ja/`. Participants
switch language from the sidebar.

## Translate last

Translate only after the English pages have passed the live verification and
strict `check-lab.sh`. Every later change to an English page means updating
each translation in the same commit. Check-lab enforces this rule: a
translation may not drift from its English page.

## Rules for each translated page

- **Same file names and the same structure.** Keep every heading, block and
  collapsible. Translate headings, prose, `Expected result` text, glossary
  terms, answer keys, `:navtitle:` and image alt text.
- **Commands are never translated.** Copy every `role="execute"` block
  verbatim, comments included. Check-lab compares them with the English page.
  This is what lets the English live verification cover the translation. Leave
  command output, field names, resource names, file paths and `{attributes}`
  as they are.
- **`Expected result`** uses the label from the table, at the start of the
  line, once for every English one.
- **`// UNVERIFIED` and `// NOT-IN-DOCS`** comments mirror the English page.
  Strict `check-lab.sh` fails on any `// UNVERIFIED` that remains in a
  translation.
- **Cross-references** stay inside the language: `xref:02-details.adoc[...]`
  resolves within the translation's own module. Link the English original with
  `xref:ROOT:<page>.adoc[...]`.
- **Screenshots** come from the English pass and are reused, not copied:
  `image::ROOT:03-create-project.png[<translated alt text>]`.
- **Step videos** are reused the same way, but Antora does not resolve `ROOT:`
  for videos: write `video::../../_images/m1-ex1.mp4[width=100%]`
  (`videos.md`). `check-lab.sh` fails on a video that does not resolve.
- **GUI labels.** The OpenShift console has its own translations. When the
  product UI offers the language, observe the labels with the UI set to that
  language (console: *User Preferences* → *Language*) during a Playwright pass
  as the participant, never from memory. When it does not, keep the English
  label in bold and add the translation in parentheses.
- **Product names** keep Red Hat's official names (OpenShift, OpenShift AI,
  Showroom). Translate the description around them.
- **Every translated `index.adoc`** opens with a `NOTE` in that language. It
  says the page is a translation, the English version is authoritative, and
  links `xref:ROOT:index.adoc[English]`.

## Nav

Each translation's `nav.adoc` is a single tree headed by the sidebar label, so
it collapses under the English nav. English track captions become text items:

```asciidoc
* xref:index.adoc[日本語]
** xref:01-overview.adoc[アーキテクチャと制御境界]
** xref:02-details.adoc[前提条件と環境]
** トラック名 (60 分)
*** xref:03-module-01-netpol.adoc[モジュール 1: ...]
** まとめ
*** xref:90-cleanup.adoc[クリーンアップ]
*** xref:91-reference.adoc[技術リファレンス]
** ファシリテーター
*** xref:92-facilitator-guide.adoc[ファシリテーターガイド]
```

## Review

Machine translation is only a draft. Ask a fluent reader to review each
language before release, and record who reviewed it in `PLAN.md`. Check-lab
proves the commands and structure match. It cannot judge the prose.

## Known limits

- The RHDP Showroom theme sets `<html lang="en">` on every page, so screen
  readers announce translated pages as English. Mention this on the
  facilitator page when a lab ships translations.
- Pagination runs through the nav in order, so *Next* on the last English page
  leads to the first translation.
