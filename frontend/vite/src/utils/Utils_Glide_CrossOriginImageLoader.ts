/**
 * Custom ImageWindowLoader for @glideapps/glide-data-grid that sets
 * `crossOrigin = "anonymous"` on image loads. The library's default
 * `ImageWindowLoaderImpl` creates `new Image()` without crossOrigin, which
 * taints the canvas when the image is cross-origin — the cell then renders
 * blank even though the image fetches successfully.
 *
 * Needed whenever grid image cells point at cross-origin URLs (e.g. our R2
 * Worker thumbnails at `VITE_R2_WORKER_URL`). The remote side must still send
 * `Access-Control-Allow-Origin` — our files Worker already does.
 *
 * Pass the instance to `<DataEditor imageWindowLoader={loader} />`.
 */

import { CellSet } from "@glideapps/glide-data-grid";
import type { ImageWindowLoader, Item } from "@glideapps/glide-data-grid";

type CacheEntry = {
    img: HTMLImageElement | undefined;
    cells: Item[];
};

export class Utils_Glide_CrossOriginImageLoader implements ImageWindowLoader {
    private cache = new Map<string, CacheEntry>();
    private callback: (locations: CellSet) => void = () => undefined;

    setWindow(): void {
        // No eviction — thumbnails have stable URLs (6-day signed TTL) and each
        // employee grid session lives minutes at most. If we ever render
        // thousands of unique thumbnails in a single session, add LRU here.
    }

    setCallback(cb: (locations: CellSet) => void): void {
        this.callback = cb;
    }

    loadOrGetImage(url: string, col: number, row: number): HTMLImageElement | undefined {
        const existing = this.cache.get(url);
        if (existing) {
            if (!existing.cells.some(([c, r]) => c === col && r === row)) {
                existing.cells.push([col, row]);
            }
            return existing.img;
        }

        const entry: CacheEntry = { img: undefined, cells: [[col, row]] };
        this.cache.set(url, entry);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.addEventListener("load", () => {
            entry.img = img;
            this.callback(new CellSet([...entry.cells]));
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug("[glide-img] loaded", {
                    url,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                });
            }
        });
        img.addEventListener("error", (ev) => {
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn("[glide-img] load error", { url, event: ev });
            }
        });
        img.src = url;

        return undefined;
    }
}
