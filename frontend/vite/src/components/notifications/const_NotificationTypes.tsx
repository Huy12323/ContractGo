import {
    ApiOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ClockCircleOutlined,
    EditOutlined,
    FileDoneOutlined,
    FileProtectOutlined,
    MailOutlined,
    StopOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { Supabase_Enums } from "@/types/supabase.types";

export type NotificationType = Supabase_Enums<"notifications_type_enum">;

/**
 * Icon and accent per notification type.
 *
 * Keyed by the enum rather than by a string so a new member of
 * `notifications_type_enum` fails the build here — the same tripwire discipline
 * as `QueryKeys`. The colours are ANTD token NAMES resolved by the caller from
 * `theme.useToken()`, never hex: a hard-coded red is invisible in the dark theme.
 */
export const const_Notification_Presentation: Record<
    NotificationType,
    {
        icon: ReactNode;
        tone: "default" | "success" | "warning" | "error" | "info";
        /**
         * The words on the row's visible action link.
         *
         * Per type rather than one generic "Open", because the label is the only
         * thing telling the reader what happens next — and for the two signer-facing
         * types it has to be honest about what it CANNOT do. `signing_submit` refuses
         * anything but a `/sign/<token>` link, so a notification saying "Sign" would
         * promise something the destination cannot deliver; it says "Review" and the
         * envelope page it opens is exactly that.
         */
        action: string;
        /**
         * TRUE when the recipient is a PARTY to the document rather than its sender.
         *
         * This decides which destination the row opens, and the distinction is not
         * cosmetic. A party's route in is the signing surface, reached by asking the
         * server to mint them a credential (`signing_link_for_me`) — the notification
         * cannot carry one, because the plaintext token exists once, in the mail
         * (CG-005). The sender's route in is the envelope page under
         * `/_protected/$organizationId`, which a party who is not a MEMBER of the
         * sending organization cannot open at all.
         *
         * Get this wrong in the party direction and an outside signer's bell item
         * points at a 403.
         */
        party?: true;
    }
> = {
    // Superseded by `organization_invitation` (CG-020), which carries the tier in
    // its copy instead of in its type. Kept because rows still reference it and
    // Postgres cannot drop an enum value; nothing writes it any more.
    admin_invitation: { icon: <TeamOutlined />, tone: "info", action: "Accept invitation" },
    organization_invitation: { icon: <TeamOutlined />, tone: "info", action: "Accept invitation" },
    employee_onboarding_invitation: {
        icon: <TeamOutlined />,
        tone: "info",
        action: "Start onboarding",
    },
    signature_request_invitation: {
        icon: <FileProtectOutlined />,
        tone: "info",
        action: "Open to sign",
        party: true,
    },
    signature_request_copy: {
        icon: <MailOutlined />,
        tone: "default",
        action: "View document",
        party: true,
    },
    signature_request_declined: {
        icon: <CloseCircleOutlined />,
        tone: "error",
        action: "Open document",
    },
    signature_request_reminder: {
        icon: <ClockCircleOutlined />,
        tone: "warning",
        action: "Open to sign",
        party: true,
    },
    signature_request_expired: { icon: <StopOutlined />, tone: "warning", action: "Open document" },
    signature_request_changes_requested: {
        icon: <EditOutlined />,
        tone: "warning",
        action: "Open to sign",
        party: true,
    },
    envelope_completed: { icon: <FileDoneOutlined />, tone: "success", action: "Open document" },
    envelope_voided: { icon: <StopOutlined />, tone: "default", action: "Open document" },
    envelope_signed_by_party: {
        icon: <CheckCircleOutlined />,
        tone: "success",
        action: "Open document",
    },
    // CG-046. The only type here that is not about a document, and the only one
    // whose tone is 'error' without anything having been declined or voided: a
    // disabled endpoint means the customer's own system has silently stopped
    // receiving events, and it stays broken until somebody acts on this row.
    webhook_endpoint_disabled: { icon: <ApiOutlined />, tone: "error", action: "Open settings" },
};
