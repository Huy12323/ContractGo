# Auto-versioning trigger with no-op dedup

Work Item: [AHR-1489](https://plane.jimbui.dev/aiur/browse/AHR-1489/)
Tier 1: [AHR-1487](https://plane.jimbui.dev/aiur/browse/AHR-1487/) [v0.0.1 | Employee Onboarding] Contract template versioning + archive-only lifecycle (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: every save of a contract template should produce an immutable audit-trail row. Saving identical content twice should not produce duplicate rows. The mechanism is fully server-side — HR's edit flow doesn't change.

Tech: SECURITY DEFINER trigger on `contract_templates` AFTER INSERT OR UPDATE. Function computes `sha256(type || layout || pdf_file_path)`, compares to the latest version's hash for that template, writes a new version row only on mismatch. Migration also recomputes AHR-1488's backfilled v1 hashes with the new formula (which now includes `type`) so dedup is consistent from row one. No frontend changes — existing `useM_ContractTemplate_Create` and `_Update` hooks work unchanged.

Related: AHR-1488 provides the `contract_template_versions` table and v1 backfill this trigger extends.

Siblings: 4 total, 1 Done (local, pending /pp) — AHR-1488 (Done local — schema foundation), AHR-1490 (Not started — invitation snapshot+pin, parallel with this T2), AHR-1491 (Not started — contract snapshot+pin, blocked by AHR-1490)
Execution Order: Step 2 of 3 — prerequisite AHR-1488 Done ✓ (local, pending /pp). Parallel-safe with AHR-1490.

## Phase A: Migration — trigger + v1 hash recompute

- [x] Create migration file: `cd frontend/vite && supabase migration new ahr1489_contract_template_versioning_trigger`
- [x] Header comment: design intent (hash includes type, recompute backfilled v1 hashes, single trigger with function-internal dedup, SECURITY DEFINER bypasses RLS, created_by from auth.uid())
- [x] PHASE 1: Recompute v1 hashes — `UPDATE public.contract_template_versions SET content_hash = encode(digest(type::text || layout::text || coalesce(pdf_file_path, ''), 'sha256'), 'hex') WHERE version_number = 1`
- [x] PHASE 2: Create function `public.write_contract_template_version()` — `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. Declares `v_new_hash TEXT`, `v_last_hash TEXT`, `v_next_version INTEGER`. Computes `v_new_hash = encode(digest(NEW.type::text || NEW.layout::text || coalesce(NEW.pdf_file_path, ''), 'sha256'), 'hex')`. Looks up latest version via `SELECT content_hash, version_number + 1 INTO v_last_hash, v_next_version FROM contract_template_versions WHERE template_id = NEW.id ORDER BY version_number DESC LIMIT 1`. Dedup: if `v_last_hash IS NOT NULL AND v_last_hash = v_new_hash` then `RETURN NEW` (skip). Else `COALESCE(v_next_version, 1)` and `INSERT INTO contract_template_versions (template_id, organization_id, version_number, type, layout, pdf_file_path, content_hash, created_by) VALUES (NEW.id, NEW.organization_id, v_next_version, NEW.type, NEW.layout, NEW.pdf_file_path, v_new_hash, auth.uid())`. Returns NEW.
- [x] PHASE 3: Create trigger — `CREATE TRIGGER trigger_write_contract_template_version AFTER INSERT OR UPDATE ON public.contract_templates FOR EACH ROW EXECUTE FUNCTION public.write_contract_template_version()`

## Phase B: Apply + verify

- [x] Apply: `supabase db push --local`
- [x] Lint: `supabase db lint --local` — confirm no new warnings from this migration's function
- [x] Verify v1 hash recompute — sample a few v1 rows; `length(content_hash) = 64` and values differ from the AHR-1488 post-migration inspection (hash prefixes recorded in AHR-1488 plan were `5cf213fc...`, `30e5496c...`, etc.; new prefixes should differ because `type::text` prefix was added to the hash input)
- [x] Sanity — INSERT a throwaway template via psql (bypasses RLS under postgres superuser): v1 row appears in `contract_template_versions` with `created_by = NULL`
- [x] Sanity — UPDATE the throwaway's layout: v2 written, different hash, v1 preserved unchanged
- [x] Sanity — Re-UPDATE with identical layout/type/pdf: no new version written, `max(version_number)` unchanged (dedup)
- [x] Sanity — UPDATE only `type` (e.g., tiptap → pdf) while layout/pdf_file_path stay same: new version written (proves hash includes type)
- [x] Sanity — UPDATE only `name` (unrelated column) on the throwaway: no new version written (dedup correctly skips)
- [x] Sanity — monotonicity: `SELECT version_number FROM contract_template_versions WHERE template_id = throwaway ORDER BY version_number` returns `1, 2, 3, ...` with no gaps
- [x] Cleanup: `DELETE FROM contract_templates WHERE id = throwaway_id` — cascades remove throwaway versions

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Migration tasks: (pending)

Phase B: (pending)

- Verify tasks: (pending)
