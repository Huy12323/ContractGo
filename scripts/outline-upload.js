#!/usr/bin/env node

/**
 * Outline Attachment Upload
 *
 * Uploads a file to Outline as an attachment, optionally linked to a document.
 * Uses two-step flow: create attachment → upload to pre-signed URL.
 *
 * Usage:
 *   node scripts/outline-upload.js <file-path> [--doc <doc-id>]
 *
 * Output:
 *   Attachment ID, URL, and markdown embed syntax.
 *   For images: ![filename](/api/attachments.redirect?id=<uuid>)
 *   For videos: [filename](/api/attachments.redirect?id=<uuid>)
 *
 * Env required: OUTLINE_API_KEY, OUTLINE_API_URL in root .env
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadConfig, parseFlags } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;

// --- MIME type detection ---
const MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || "application/octet-stream";
}

function isImage(mimeType) {
    return mimeType.startsWith("image/");
}

function isVideo(mimeType) {
    return mimeType.startsWith("video/");
}

// --- Video dimension detection via ffprobe ---
function getVideoDimensions(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`,
            { encoding: "utf-8", timeout: 10000 }
        ).trim();
        const match = out.match(/^(\d+)x(\d+)$/);
        return match ? out : null;
    } catch {
        return null;
    }
}

// --- Parse doc ID from various formats ---
function parseDocId(input) {
    if (!input) return null;
    const uuidMatch = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) return uuidMatch[0];
    const slugMatch = input.match(/\/doc\/([a-zA-Z0-9-]+)/);
    if (slugMatch) return slugMatch[1];
    return input;
}

// --- Main ---
async function main() {
    // Parse args: <file-path> [--doc <doc-id>]
    let filePath = null;
    let docId = null;

    for (let i = 0; i < cliArgs.length; i++) {
        if (cliArgs[i] === "--doc" && i + 1 < cliArgs.length) {
            docId = parseDocId(cliArgs[i + 1]);
            i++;
        } else if (!filePath) {
            filePath = cliArgs[i];
        }
    }

    if (!filePath) {
        console.error("Usage: node scripts/outline-upload.js <file-path> [--doc <doc-id>]");
        process.exit(1);
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
    }

    const fileName = path.basename(resolvedPath);
    const mimeType = getMimeType(resolvedPath);
    const fileSize = fs.statSync(resolvedPath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

    const apiUrl = config.OUTLINE_API_URL;
    const apiKey = config.OUTLINE_API_KEY;

    if (!apiUrl || !apiKey) {
        console.error("Missing OUTLINE_API_URL or OUTLINE_API_KEY in .env");
        process.exit(1);
    }

    console.log(`Uploading: ${fileName}`);
    console.log(`  Path: ${resolvedPath}`);
    console.log(`  Type: ${mimeType}`);
    console.log(`  Size: ${sizeMB} MB`);
    if (docId) console.log(`  Doc:  ${docId}`);

    // Step 1: Create attachment record (get upload URL)
    const createBody = {
        name: fileName,
        contentType: mimeType,
        size: fileSize,
    };
    if (docId) createBody.documentId = docId;

    const createRes = await fetch(`${apiUrl}/attachments.create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Create API ${createRes.status}: ${errText}`);
    }

    const createResult = await createRes.json();
    const { uploadUrl: rawUploadUrl, form, attachment } = createResult.data;

    // Resolve relative upload URLs against the Outline base
    const baseUrl = apiUrl.replace(/\/api\/?$/, "");
    const uploadUrl = rawUploadUrl.startsWith("/") ? `${baseUrl}${rawUploadUrl}` : rawUploadUrl;

    console.log(`  Attachment ID: ${attachment.id}`);

    // Step 2: Upload file to the provided URL
    const buffer = fs.readFileSync(resolvedPath);
    const isLocal = rawUploadUrl.startsWith("/api/");

    if (isLocal) {
        // Outline local storage — POST multipart with auth
        const formData = new FormData();
        if (form) {
            for (const [key, value] of Object.entries(form)) {
                formData.append(key, value);
            }
        }
        formData.append("file", new File([buffer], fileName, { type: mimeType }));

        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
        });

        if (!uploadRes.ok && uploadRes.status !== 204) {
            const errText = await uploadRes.text();
            throw new Error(`Upload ${uploadRes.status}: ${errText}`);
        }
    } else if (form) {
        // S3-style upload with pre-signed form fields
        const formData = new FormData();
        for (const [key, value] of Object.entries(form)) {
            formData.append(key, value);
        }
        formData.append("file", new File([buffer], fileName, { type: mimeType }));

        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            body: formData,
        });

        if (!uploadRes.ok && uploadRes.status !== 204) {
            const errText = await uploadRes.text();
            throw new Error(`Upload ${uploadRes.status}: ${errText}`);
        }
    } else {
        // Direct PUT upload
        const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: buffer,
        });

        if (!uploadRes.ok && uploadRes.status !== 200) {
            const errText = await uploadRes.text();
            throw new Error(`Upload ${uploadRes.status}: ${errText}`);
        }
    }

    // Build markdown embed
    const attUrl = attachment.url;
    let markdown;
    if (isImage(mimeType)) {
        markdown = `![${fileName}](${attUrl})`;
    } else if (isVideo(mimeType)) {
        // Outline renders video player when link text includes WxH dimensions
        const dims = getVideoDimensions(resolvedPath);
        const label = dims ? `${fileName} ${dims}` : fileName;
        markdown = `[${label}](${attUrl})`;
        if (dims) console.log(`  Dimensions: ${dims}`);
    } else {
        markdown = `[${fileName}](${attUrl})`;
    }

    console.log(`\nUploaded: ${fileName}`);
    console.log(`  URL:      ${attUrl}`);
    console.log(`  Markdown: ${markdown}`);

    // Machine-readable output
    console.log(`\n--- OUTPUT ---`);
    console.log(`ATTACHMENT_ID=${attachment.id}`);
    console.log(`ATTACHMENT_URL=${attUrl}`);
    console.log(`MARKDOWN=${markdown}`);
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
