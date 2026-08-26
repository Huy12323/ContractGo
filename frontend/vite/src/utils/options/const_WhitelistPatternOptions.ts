// How a `public.whitelist` row matches an address — CG-034.
//
// LOCATION. The bible co-locates option files with their domain's components, and
// this one has no domain folder because it has no screen: the roster is managed by
// hand in Studio, and `public.whitelist` has RLS on with zero policies so no client
// can list it anyway. It sits beside `EnumsToOptions` until an admin surface exists
// to own it, at which point it moves next to that surface.
//
// It is written NOW rather than with that screen because the `satisfies Record<...>`
// below is the tripwire: `whitelist_pattern_enum` is the kind of enum that grows
// (a `regex` kind has already been discussed and rejected once), and a value added
// in SQL without copy here should fail the build rather than reach an operator as
// an unlabelled dropdown entry.
//
// THE DESCRIPTIONS ARE THE FEATURE, for the same reason as the signer-auth options:
// `domain` and `wildcard` overlap for the common case, so an operator choosing
// between them from labels alone has been told nothing. Each says what it matches
// and, where it matters, what it will NOT match.

import type { Supabase_Enums } from "@/types/supabase.types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

export type Whitelist_Pattern = Supabase_Enums<"whitelist_pattern_enum">;

type WhitelistPatternOption = {
    value: Whitelist_Pattern;
    label: string;
    /** Shown under the label wherever the kind is chosen rather than displayed. */
    description: string;
    /** A worked example, because the shape of `value` differs per kind. */
    example: string;
    /** An ANTD Tag colour, for a roster list. */
    color: string;
};

// KEY ORDER IS RENDER ORDER (`Utils_Options_EnumsToOptions` is `Object.values`).
// `domain` leads because it is the one an operator should reach for first — see
// its description. This does not match the Postgres enum's declaration order and
// nothing reads these positionally.
const Whitelist_Patterns = {
    domain: {
        value: "domain",
        label: "Everyone at a domain",
        // The safety argument, stated plainly: this kind cannot be written in a
        // way that matches more than intended, because it compares the domain part
        // rather than a suffix of the whole address.
        description:
            "Approves every address whose domain is exactly this. Subdomains and lookalike domains are not included — gotosoft.net does not approve mail.gotosoft.net or evil-gotosoft.net.",
        example: "gotosoft.net",
        color: "processing",
    },
    exact: {
        value: "exact",
        label: "One specific address",
        description: "Approves this address and nothing else.",
        example: "abc@gmail.com",
        color: "default",
    },
    wildcard: {
        value: "wildcard",
        label: "Address pattern",
        // Says what it costs. A wildcard is the only kind where a typo silently
        // widens the grant, so the operator is pointed back at `domain`.
        description:
            "Approves any address matching the pattern, where * stands for any run of characters. Use this only for cases a domain rule cannot express — a stray * matches more than you meant, and nothing will tell you.",
        example: "qa+*@gotosoft.net",
        color: "warning",
    },
} satisfies Record<Whitelist_Pattern, WhitelistPatternOption>;

export const const_WhitelistPatternOptions = Utils_Options_EnumsToOptions(Whitelist_Patterns);

/** Lookup for a roster list, which renders one rather than choosing. */
export const utils_Whitelist_PatternOption = (value: Whitelist_Pattern): WhitelistPatternOption =>
    Whitelist_Patterns[value] ?? Whitelist_Patterns.exact;
