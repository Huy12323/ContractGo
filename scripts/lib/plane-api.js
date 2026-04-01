/**
 * Plane API utilities — shared fetch helpers for cycle/module relationships.
 *
 * The Plane v1 public API does not return cycle or module membership on work items.
 * These utilities provide paginated, field-optimized access to cycle-issues and
 * module-issues endpoints, plus reverse lookups (item → cycle/module).
 *
 * API findings (tested 2026-03-06):
 *   - Work item response has no cycle/module fields; expand=cycle,module is ignored
 *   - No reverse endpoint (GET /work-items/{id}/cycles/ → 404)
 *   - cycle-issues/?fields=id works — returns only { id } per item (~45 chars vs ~1475)
 *   - per_page accepts up to at least 1000; server returns min(per_page, total)
 *   - Pagination via ?cursor={next_cursor} when next_page_results === true
 */

/**
 * Paginated fetch of items from a Plane list endpoint.
 *
 * @param {string} url - Full endpoint URL (e.g., .../cycles/{id}/cycle-issues/)
 * @param {object} headers - Request headers with API key
 * @param {object} [opts]
 * @param {string} [opts.fields] - Comma-separated fields (e.g., "id" or "id,name,state")
 * @param {number} [opts.perPage=500] - Items per page
 * @returns {Promise<object[]>} All items across all pages
 */
async function fetchAllPages(url, headers, opts = {}) {
  const perPage = opts.perPage || 500;
  const fieldsParam = opts.fields ? `&fields=${opts.fields}` : "";
  const sep = url.includes("?") ? "&" : "?";
  let cursor = null;
  const all = [];

  do {
    const cursorParam = cursor ? `&cursor=${cursor}` : "";
    const fullUrl = `${url}${sep}per_page=${perPage}${fieldsParam}${cursorParam}`;
    const res = await fetch(fullUrl, { headers });
    if (res.status !== 200) break;
    const data = await res.json();
    const list = data.results || data;
    all.push(...(Array.isArray(list) ? list : []));
    cursor = data.next_page_results ? data.next_cursor : null;
  } while (cursor);

  return all;
}

/**
 * Fetch all items in a cycle.
 *
 * @param {string} projBase - Project API base URL (.../projects/{id})
 * @param {object} headers - Request headers
 * @param {string} cycleId - Cycle UUID
 * @param {object} [opts] - { fields, perPage } passed to fetchAllPages
 * @returns {Promise<object[]>}
 */
async function fetchCycleItems(projBase, headers, cycleId, opts = {}) {
  return fetchAllPages(`${projBase}/cycles/${cycleId}/cycle-issues/`, headers, opts);
}

/**
 * Fetch all items in a module.
 *
 * @param {string} projBase - Project API base URL (.../projects/{id})
 * @param {object} headers - Request headers
 * @param {string} moduleId - Module UUID
 * @param {object} [opts] - { fields, perPage } passed to fetchAllPages
 * @returns {Promise<object[]>}
 */
async function fetchModuleItems(projBase, headers, moduleId, opts = {}) {
  return fetchAllPages(`${projBase}/modules/${moduleId}/module-issues/`, headers, opts);
}

/**
 * Find which cycle an item belongs to.
 * Uses fields=id for minimal payload (~15 KB per cycle vs ~500 KB).
 *
 * @param {string} projBase - Project API base URL
 * @param {object} headers - Request headers
 * @param {string} itemUuid - Work item UUID to find
 * @returns {Promise<{ name: string, id: string } | null>}
 */
async function findCycleForItem(projBase, headers, itemUuid) {
  const r = await fetch(`${projBase}/cycles/`, { headers });
  if (r.status !== 200) return null;
  const data = await r.json();
  const cycles = data.results || data;

  for (const c of cycles) {
    const items = await fetchCycleItems(projBase, headers, c.id, { fields: "id" });
    if (items.some(i => i.id === itemUuid)) {
      return { name: c.name, id: c.id };
    }
  }
  return null;
}

/**
 * Find which module(s) an item belongs to.
 * Uses fields=id for minimal payload.
 *
 * @param {string} projBase - Project API base URL
 * @param {object} headers - Request headers
 * @param {string} itemUuid - Work item UUID to find
 * @returns {Promise<Array<{ name: string, id: string }>>}
 */
async function findModulesForItem(projBase, headers, itemUuid) {
  const r = await fetch(`${projBase}/modules/`, { headers });
  if (r.status !== 200) return [];
  const data = await r.json();
  const modules = data.results || data;
  const found = [];

  for (const m of modules) {
    const items = await fetchModuleItems(projBase, headers, m.id, { fields: "id" });
    if (items.some(i => i.id === itemUuid)) {
      found.push({ name: m.name, id: m.id });
    }
  }
  return found;
}

module.exports = {
  fetchAllPages,
  fetchCycleItems,
  fetchModuleItems,
  findCycleForItem,
  findModulesForItem,
};
