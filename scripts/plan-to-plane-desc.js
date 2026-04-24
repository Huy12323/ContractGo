#!/usr/bin/env node
/**
 * plan-to-plane-desc.js — convert a local plan file (.md) into Plane-ready HTML
 * for a T2 description body.
 *
 * Pipeline:
 *   1. Read plan file.
 *   2. Strip the trailing `## Context` section (everything from `## Context` to EOF).
 *      Context lives in the plan file only — it's stale after ship and not useful
 *      on Plane.
 *   3. Convert markdown → minimal HTML that Plane's editor renders cleanly.
 *   4. Extract the T2 identifier from the filename ({PROJECT_IDENTIFIER}-N-slug.md).
 *   5. Write to temp/plane/{IDENT}.html.
 *   6. Print the output path to stdout (for shell capture).
 *
 * Usage:
 *   node scripts/plan-to-plane-desc.js cycles/2026-17/module/T1-ID/T2-IDENT-slug.md
 *
 * Then feed the printed path into plane-item-update.js:
 *   OUT=$(node scripts/plan-to-plane-desc.js <plan>)
 *   node scripts/plane-item-update.js {T2-IDENT} --desc-file "$OUT"
 *
 * Design note — we hand-roll the MD→HTML converter instead of adding `marked`
 * or similar as a dep. The plan-file markdown subset is small and stable
 * (headings, paragraphs, bullet + task lists, bold, italic, inline code,
 * links, blockquote, horizontal rule). ~120 lines of regex is cheaper than
 * an npm dep and avoids the install-step friction for consumers.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ─── CLI ────────────────────────────────────────────────────────────────────

const planPath = process.argv[2];
if (!planPath) {
    console.error("Usage: plan-to-plane-desc.js <plan-file.md>");
    process.exit(1);
}

if (!fs.existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
}

const raw = fs.readFileSync(planPath, "utf8");

// ─── Step 1: Strip ## Context section ──────────────────────────────────────
// Match `\n## Context ...` through either the NEXT `\n## ` heading (legacy
// plan files where Context sat in the middle) OR end-of-string (new format
// where Context is always the last section). The lazy `[\s\S]*?` plus
// lookahead disjunction covers both layouts. Case-insensitive on the
// section title; the plan-file convention is `## Context` but we tolerate
// `## context` too.

const stripped = raw
    .replace(/\n##\s+Context\b[\s\S]*?(?=\n##\s|$)/i, "")
    .trimEnd();

// ─── Step 2: Markdown → HTML ───────────────────────────────────────────────

const html = mdToHtml(stripped);

// ─── Step 3: Resolve output path from identifier ───────────────────────────

const base = path.basename(planPath, ".md");
const identMatch = base.match(/^([A-Z][A-Z0-9_]*-\d+)/);
if (!identMatch) {
    console.error(`Could not parse identifier from filename: ${base}`);
    console.error(
        "Plan files must start with {PROJECT_IDENTIFIER}-N (e.g. SPARK-3854-slug.md).",
    );
    process.exit(1);
}
const ident = identMatch[1];

const outDir = path.join(process.cwd(), "temp", "plane");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${ident}.html`);
fs.writeFileSync(outPath, html);

console.log(outPath);

// ─── Minimal MD → HTML converter ───────────────────────────────────────────

function mdToHtml(input) {
    const lines = input.split(/\r?\n/);
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Blank line — flush nothing, just skip.
        if (/^\s*$/.test(line)) {
            i++;
            continue;
        }

        // Horizontal rule
        if (/^\s*---+\s*$/.test(line)) {
            out.push("<hr>");
            i++;
            continue;
        }

        // Headings (# through ######)
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        // Blockquote — collect consecutive `>` lines.
        if (/^\s*>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>\s?/, ""));
                i++;
            }
            out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`);
            continue;
        }

        // Unordered list — collect consecutive `- ...` (or `* ...`) lines.
        // Tasks (`- [ ]` / `- [x]`) render as checkbox-prefixed items.
        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                let content = lines[i].replace(/^\s*[-*]\s+/, "");

                // Task checkbox
                const task = content.match(/^\[([ xX])\]\s+(.*)$/);
                let prefix = "";
                if (task) {
                    const checked = /[xX]/.test(task[1]);
                    prefix = checked
                        ? '<input type="checkbox" checked disabled> '
                        : '<input type="checkbox" disabled> ';
                    content = task[2];
                }

                // Support a continuation line after a list item (the
                // `**Rationale:** ...` second line of a Decisions bullet).
                // If the next line starts with whitespace and is not a new
                // list item, append it to the current item as a line break.
                let j = i + 1;
                const continuations = [];
                while (
                    j < lines.length &&
                    /^\s{2,}\S/.test(lines[j]) &&
                    !/^\s*[-*]\s+/.test(lines[j]) &&
                    !/^\s*$/.test(lines[j])
                ) {
                    continuations.push(lines[j].trim());
                    j++;
                }
                const tail = continuations.length
                    ? "<br>" + continuations.map(inline).join("<br>")
                    : "";

                items.push(`<li>${prefix}${inline(content)}${tail}</li>`);
                i = j;
            }
            out.push(`<ul>${items.join("")}</ul>`);
            continue;
        }

        // Fenced code block (``` ... ```)
        if (/^\s*```/.test(line)) {
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            i++; // consume closing fence
            const escaped = buf
                .join("\n")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
            out.push(`<pre><code>${escaped}</code></pre>`);
            continue;
        }

        // Paragraph — collect until blank line or block element starts.
        const buf = [line];
        i++;
        while (
            i < lines.length &&
            !/^\s*$/.test(lines[i]) &&
            !/^(#{1,6})\s/.test(lines[i]) &&
            !/^\s*[-*]\s+/.test(lines[i]) &&
            !/^\s*>/.test(lines[i]) &&
            !/^\s*---+\s*$/.test(lines[i]) &&
            !/^\s*```/.test(lines[i])
        ) {
            buf.push(lines[i]);
            i++;
        }
        out.push(`<p>${inline(buf.join(" "))}</p>`);
    }

    return out.join("\n");
}

// Inline converter: code spans, bold, italic, links. Order matters:
// code spans FIRST (they protect their content from other transforms via
// placeholder substitution).
function inline(text) {
    if (!text) return "";

    // Escape HTML entities in raw text first, but keep placeholders for
    // code spans that need escaping applied to their content too.
    const codeSpans = [];
    let s = text.replace(/`([^`]+)`/g, (_, content) => {
        codeSpans.push(content);
        return `\x00CODE${codeSpans.length - 1}\x00`;
    });

    // Escape HTML special chars in the remaining text.
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        return `<a href="${url}">${label}</a>`;
    });

    // Bold: **text** (before italic so ** doesn't get eaten by *).
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Italic with `*`: *text* — only when not adjacent to another *.
    s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");

    // Italic with `_`: only treat `_` as emphasis at word boundaries, not
    // inside identifiers. `Page_Scene`, `scene_file_animations`, etc. should
    // render as literal text. Rule: the opening `_` must be preceded by
    // start-of-string or a non-word char, and the closing `_` must be
    // followed by a non-word char or end-of-string. (CommonMark §6.2.)
    s = s.replace(
        /(^|[^\w_])_(?=[^\s_])([^_]+?)_(?=[^\w]|$)/g,
        "$1<em>$2</em>",
    );

    // Restore code spans (escape inside).
    s = s.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
        const raw = codeSpans[Number(idx)]
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        return `<code>${raw}</code>`;
    });

    return s;
}
