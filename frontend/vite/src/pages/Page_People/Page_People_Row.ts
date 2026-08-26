/**
 * The shape the People table renders and the drawer opens on, plus how a role
 * and a status look.
 *
 * Shared rather than local to Page_People because the drawer shows the same two
 * tags in its header — one source, so a role can never be blue in the table and
 * grey a click later.
 */
export type PersonRow = {
    key: string;
    /** Invitation id — present only on rows that can be resent or cancelled. */
    invitationId: string | null;
    /**
     * The auth user behind this row, and the argument every membership RPC takes.
     * Null on invitations: nobody has accepted yet, so there is no user to act on.
     */
    userId: string | null;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    role: "owner" | "admin" | "member";
    status: "active" | "pending" | "expired" | "declined";
    /** Invitation rows only. */
    invitedAt: string | null;
    /** Invitation rows only. */
    expiresAt: string | null;
    /**
     * CG-027 permission flags, for the tags beside the role. True on owner and
     * admin rows, who hold both by tier; false on invitations, which have no
     * membership row yet and therefore nothing granted.
     */
    canManageTemplates: boolean;
    canSendDocuments: boolean;
};

export const ROLE_TAG: Record<PersonRow["role"], { color: string; label: string }> = {
    owner: { color: "gold", label: "Owner" },
    admin: { color: "blue", label: "Admin" },
    member: { color: "default", label: "Member" },
};

export const STATUS_TAG: Record<PersonRow["status"], { color: string; label: string }> = {
    active: { color: "green", label: "Active" },
    pending: { color: "orange", label: "Pending" },
    expired: { color: "red", label: "Expired" },
    declined: { color: "red", label: "Declined" },
};
