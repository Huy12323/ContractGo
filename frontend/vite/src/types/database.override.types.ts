import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";

// Add JSONB column overrides here as your schema grows
type DatabaseOverrides = {
    public: { Tables: {} };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;
