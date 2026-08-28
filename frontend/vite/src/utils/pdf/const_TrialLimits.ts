// Limits for the no-account signing trial (CG-052).
//
// DELIBERATELY NOT `MAX_UPLOAD_SIZE_BYTES` (50MB). That constant is an
// upload/infra policy ceiling — how big a file the product will accept into R2.
// This is a BROWSER HEAP ceiling. The trial never uploads anything: pdf.js
// renders the document and pdf-lib parses and re-saves it, which holds roughly
// 3–4x the file in JS memory at once. 50MB of that kills a mid-range phone, so
// the two numbers answer different questions and must not be shared.
//
// The cap is also a conversion surface, not a dead end — the message that
// carries it names the 50MB an account gets you.

export const const_Trial_MaxFileSizeMB = 10;
export const const_Trial_MaxFileSizeBytes = const_Trial_MaxFileSizeMB * 1024 * 1024;

/** Above this the trial stops being a one-minute demo and starts being work. */
export const const_Trial_MaxPages = 20;

/** Enough to place a signature, a name and a date several times over. */
export const const_Trial_MaxFields = 12;
