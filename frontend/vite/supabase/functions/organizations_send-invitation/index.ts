/**
 * organizations_send-invitation — invite a person into an organization.
 *
 * AUTHENTICATED (`verify_jwt` defaults to true; deliberately NOT listed in the
 * public block of config.toml). Replaces `admins_send-invitation`, which could
 * only ever mean "become an admin" and could only ever be called by
 * `organizations.owner_id`.
 *
 * Two things changed with CG-020:
 *
 *   ROLE. The body carries `admin` or `member`, stored on the invitation and
 *   read back by `accept_invitation` to decide which table the accepting user
 *   lands in. The email and the in-app notification say which tier.
 *
 *   WHO MAY SEND. The owner-only gate is gone; this uses `resolveSender` — the
 *   same admin-or-owner resolution every envelope function uses. That is not
 *   just consistency: an admin who can send a contract to a counterparty but
 *   cannot add a colleague to the workspace is a permission model nobody can
 *   explain.
 *
 * RESEND IS THE SAME CALL. `unique(organization_id, email)` plus an upsert
 * means inviting an address that already has a pending invitation re-issues the
 * token and pushes the expiry out. There is deliberately no separate endpoint:
 * two code paths that must stay identical eventually don't.
 *
 * ORDERING. Write the row, then send the mail, then report success — the
 * discipline `_shared/envelopeNotify.ts` follows for signer notification. A row
 * with no mail is recoverable (resend); a mail whose token was never stored is
 * not.
 */

import { jsonResponse, requireEnv } from "../_shared/http.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";

const INVITATION_TTL_DAYS = 7;

type InvitationRole = "admin" | "member";

const ROLE_LABEL: Record<InvitationRole, string> = {
    admin: "Admin",
    member: "Member",
};

/** "an Admin" / "a Member" — the mail reads as a sentence, not a form field. */
const ROLE_ARTICLE: Record<InvitationRole, string> = {
    admin: "an",
    member: "a",
};

serveSenderFunction("organizations_send-invitation", async (body, req) => {
    const organizationId = String(body.organization_id ?? "");
    const rawEmail = String(body.email ?? "")
        .trim()
        .toLowerCase();
    const role = (body.role ?? "admin") as InvitationRole;

    if (!rawEmail) {
        return jsonResponse({ error: "email is required" }, 400);
    }
    if (role !== "admin" && role !== "member") {
        return jsonResponse({ error: "role must be 'admin' or 'member'" }, 400);
    }

    // Admin-or-owner of THIS organization, plus a service_role client and the
    // caller's resolved identity. Its 403 is worded for the envelope functions,
    // so it is restated here for the surface the caller is actually on.
    //
    // CG-027 made "sender" a permission rather than a tier, and this stays
    // `"admin"` deliberately: adding people to the organization is administration,
    // not document work. A member granted `send_documents` can put a contract in
    // front of a counterparty; they still cannot grow the organization.
    let sender;
    try {
        sender = await resolveSender(req, organizationId, "admin");
    } catch (err) {
        if (err instanceof SenderAuthError && err.status === 403) {
            throw new SenderAuthError(
                403,
                "Only admins and owners can invite people to an organization"
            );
        }
        throw err;
    }

    const { admin, organizationName, userId } = sender;

    // Don't invite somebody who is already here. Without this the People page
    // grows a permanent "Pending" row that can never be accepted —
    // `accept_invitation` would return `already_admin` and consume it, but only
    // if the invitee ever bothered to click, and the sender would meanwhile see
    // a phantom.
    const { data: existingProfile } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", rawEmail)
        .maybeSingle();

    if (existingProfile) {
        const [{ data: adminRow }, { data: memberRow }] = await Promise.all([
            admin
                .from("admins")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("user_id", existingProfile.id)
                .maybeSingle(),
            admin
                .from("members")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("user_id", existingProfile.id)
                .maybeSingle(),
        ]);

        if (adminRow || memberRow) {
            return jsonResponse(
                { error: `${rawEmail} is already part of ${organizationName}` },
                409
            );
        }
    }

    // The owner is not in `admins` by definition of the membership model, so the
    // check above misses exactly one person: the owner inviting themselves.
    const { data: org } = await admin
        .from("organizations")
        .select("owner_id, profiles:owner_id (email)")
        .eq("id", organizationId)
        .maybeSingle();

    const ownerEmail = (org?.profiles as { email?: string } | null)?.email;
    if (ownerEmail && ownerEmail.toLowerCase() === rawEmail) {
        return jsonResponse({ error: `${rawEmail} owns ${organizationName}` }, 409);
    }

    const expiresAt = new Date(
        Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const token = crypto.randomUUID();

    const { data: invitation, error: upsertError } = await admin
        .from("invitations")
        .upsert(
            {
                organization_id: organizationId,
                email: rawEmail,
                role,
                token,
                // A resend revives a rejected or expired invitation rather than
                // leaving a dead row the sender cannot clear.
                status: "pending",
                invited_by: userId,
                expires_at: expiresAt,
            },
            { onConflict: "organization_id,email" }
        )
        .select("id, token, role")
        .single();

    if (upsertError) {
        console.error("organizations_send-invitation upsert failed:", upsertError);
        return jsonResponse({ error: upsertError.message }, 500);
    }

    const inviterName = sender.evidence.actor.name ?? sender.evidence.actor.email;
    const invitationLink = `${requireEnv("APP_URL")}/invitation?token=${invitation.token}`;

    const emailRes = await fetch(`${requireEnv("SUPABASE_URL")}/functions/v1/shared--send-email`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            scenario: "organization_invitation",
            to: rawEmail,
            payload: {
                orgName: organizationName,
                roleLabel: ROLE_LABEL[role],
                roleArticle: ROLE_ARTICLE[role],
                inviterLine: inviterName ? `${inviterName} invited you. ` : "",
                invitationLink,
            },
            // CG-050. TOP-LEVEL, and this call site is the clearest illustration
            // of why it could not ride on `notify`: the `notify` block below
            // deliberately omits `organizationId`, for a reason that is about
            // WHERE A NOTIFICATION ROW IS FILED and has nothing to do with whose
            // logo belongs on the message. The invitee is not a member yet — but
            // the invitation is unmistakably FROM this organization, and it is
            // the first thing they ever see of it.
            organization_id: organizationId,
            // CG-018. Deliberately NO `organizationId`: the invitee is not a
            // member of this organization yet — that is what the invitation
            // is for — so stamping it would file the notification under an
            // org they cannot see. The link is app-relative; the mail keeps
            // the absolute one. If the address belongs to no account yet the
            // mirror is a no-op and the email is the only channel, which is
            // the designed behaviour.
            notify: { link: `/invitation?token=${invitation.token}` },
        }),
    });

    if (!emailRes.ok) {
        console.error("organizations_send-invitation email failed:", await emailRes.text());
        return jsonResponse({ error: "Failed to send invitation email" }, 500);
    }

    return jsonResponse({ id: invitation.id, role: invitation.role, status: "sent" }, 200);
});
