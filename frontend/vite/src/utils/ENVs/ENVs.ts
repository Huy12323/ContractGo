import jetEnv, { str } from "jet-env";

const baseENVs = jetEnv(
    {
        ViteSupabaseUrl: str,
        ViteSupabaseAnonKey: str,
        ViteR2WorkerUrl: str,
    },
    { getValue: (key) => import.meta.env[key] }
);

const ENVs = {
    ...baseENVs,
    /**
     * Mirrors the edge functions' `STORAGE_DRIVER`. The frontend needs it for one
     * question only: where an avatar's bytes are served from.
     *
     * Avatars are the single file type read WITHOUT an edge-function round trip —
     * they are public by design, so the URL is built by concatenation rather than
     * signed. That means the origin has to be right, and it differs by driver: the
     * R2 Worker under `r2`, a public Supabase Storage bucket under `local`. Every
     * other file type asks `files_r2_sign-read-url`, which resolves the driver
     * server-side and never needs this.
     *
     * NOT declared in the `jetEnv` schema above, deliberately: that schema is
     * required-or-crash, and adding a required var would break every existing
     * deployment whose `.env` predates it. Defaulting to `r2` matches the server's
     * own default in `getStorageDriverName()`, so an env that never sets it
     * behaves exactly as it did before this existed.
     */
    get ViteStorageDriver(): "local" | "r2" {
        return import.meta.env.VITE_STORAGE_DRIVER === "local" ? "local" : "r2";
    },
    get isDev(): boolean {
        return import.meta.env.DEV;
    },
    get isProd(): boolean {
        return import.meta.env.PROD;
    },
    get mode(): string {
        return import.meta.env.MODE;
    },
} as const;

export { ENVs };
