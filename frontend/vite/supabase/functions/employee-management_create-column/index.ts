import { createClient } from "supabase";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

const PG_TYPE_MAP: Record<string, string> = {
    text: "text",
    number: "numeric",
    date: "date",
    boolean: "boolean",
    single_select: "text",
    multi_select: "text[]",
    file: "text",
};

const VALID_TYPES = ["text", "number", "date", "boolean", "single_select", "multi_select", "file"];

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
        // Authenticate caller
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return jsonResponse({ error: "Missing authorization" }, 401);
        }

        const supabaseUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
        if (authError || !user) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        // Parse request body
        const { label, type, choices, entity_id, config } = await req.json() as {
            label?: string;
            type?: string;
            choices?: unknown;
            entity_id?: string;
            config?: unknown;
        };

        if (!label || typeof label !== "string" || !label.trim()) {
            return jsonResponse({ error: "label is required" }, 400);
        }
        if (!type || !VALID_TYPES.includes(type)) {
            return jsonResponse({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, 400);
        }
        if (!entity_id || typeof entity_id !== "string") {
            return jsonResponse({ error: "entity_id is required" }, 400);
        }
        if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
            return jsonResponse({ error: "config must be a plain object" }, 400);
        }
        const configValue = (config ?? {}) as Record<string, unknown>;

        // Resolve organization_id from entity and verify caller is admin or owner
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: entity, error: entityError } = await supabaseAdmin
            .from("entities")
            .select("id, organization_id")
            .eq("id", entity_id)
            .single();

        if (entityError || !entity) {
            return jsonResponse({ error: "Entity not found" }, 404);
        }

        const organization_id = entity.organization_id;

        const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("owner_id")
            .eq("id", organization_id)
            .single();

        const isOwner = org?.owner_id === user.id;

        let isAdmin = false;
        if (!isOwner) {
            const { data: adminRow } = await supabaseAdmin
                .from("admins")
                .select("id")
                .eq("organization_id", organization_id)
                .eq("user_id", user.id)
                .single();
            isAdmin = !!adminRow;
        }

        if (!isOwner && !isAdmin) {
            return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
        }

        // Insert column metadata
        const { data: column, error: insertError } = await supabaseAdmin
            .from("employee_columns")
            .insert({
                entity_id,
                label: label.trim(),
                type,
                config: configValue,
            })
            .select()
            .single();

        if (insertError || !column) {
            console.error("Insert error:", insertError);
            return jsonResponse({ error: "Failed to create column metadata" }, 500);
        }

        // Create choice rows for single_select / multi_select columns
        if ((type === "single_select" || type === "multi_select") && Array.isArray(choices) && choices.length > 0) {
            const choiceRows = (choices as string[])
                .filter((c: string) => typeof c === "string" && c.trim())
                .map((choiceLabel: string, idx: number) => ({
                    employee_column_id: column.id,
                    label: choiceLabel.trim(),
                    sort_order: idx,
                }));

            if (choiceRows.length > 0) {
                const { error: choicesError } = await supabaseAdmin
                    .from("employee_column_choices")
                    .insert(choiceRows);
                if (choicesError) {
                    console.error("Choices insert error:", choicesError);
                    // Non-fatal — column is created, choices can be added later
                }
            }
        }

        // ALTER TABLE on the entity's per-entity table — add the actual PG column via RPC.
        const pgType = PG_TYPE_MAP[type];
        const { error: alterError } = await supabaseUser.rpc("add_employee_column", {
            p_entity_id: entity_id,
            p_col_name: column.id,
            p_col_type: pgType,
        });

        if (alterError) {
            // Rollback: delete the metadata row
            await supabaseAdmin
                .from("employee_columns")
                .delete()
                .eq("id", column.id);

            console.error("ALTER TABLE error:", alterError);
            const isLockTimeout = /lock_timeout|canceling statement due to lock timeout/i.test(alterError.message ?? "");
            return jsonResponse({
                error: isLockTimeout
                    ? "Database is busy, please retry in a few seconds"
                    : "Failed to add column to employees table",
            }, 500);
        }

        return jsonResponse({ data: column }, 201);
    } catch (err) {
        console.error("employee-management_create-column error:", err);
        return jsonResponse({
            error: err instanceof Error ? err.message : "Internal error",
        }, 500);
    }
});
