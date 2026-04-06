import jetEnv, { str } from "jet-env";

const baseENVs = jetEnv(
    {
        ViteSupabaseUrl: str,
        ViteSupabaseAnonKey: str,
    },
    { getValue: (key) => import.meta.env[key] },
);

const ENVs = {
    ...baseENVs,
    get isDev(): boolean { return import.meta.env.DEV; },
    get isProd(): boolean { return import.meta.env.PROD; },
    get mode(): string { return import.meta.env.MODE; },
} as const;

export { ENVs };
