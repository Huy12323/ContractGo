// [ekyc] Step 2 of 4 — prove who you are, before filling anything in.
//
// Thin by design, exactly like `PageSign_Filler`: `App_SigningIdentityGate` owns
// the whole surface and this file owns only the step's frame and its navigation.
//
// IT OWNS `flex: 1, minHeight: 0` AND ITS OWN SCROLL, and that is not a style
// preference. `_public/route.tsx` wraps the signer surface in
// `height: var(--app-vh); overflow: hidden`, so anything that tries to grow is
// clipped rather than scrolled — and a document-capture panel with a rejection
// result in it is tall.
//
// BACK IS OFFERED, CONTINUE IS NOT. The signer may return to re-read the
// document at any time; they advance only when the server has recorded an
// approval, which the gate raises through `onVerified`.

import { Button, Space, theme } from "antd";
import { App_SigningIdentityGate } from "@/components/signing/App_SigningIdentityGate";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

type Props = {
    accessToken: string;
    identityCheck: Signing_Session["identity_check"];
    onVerified: () => void;
    onDecline: () => void;
    onBack: () => void;
};

export const PageSign_IdentityStep = ({
    accessToken,
    identityCheck,
    onVerified,
    onDecline,
    onBack,
}: Props) => {
    const { token } = theme.useToken();

    return (
        <div
            style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
                gap: token.marginMD,
            }}
        >
            <App_SigningIdentityGate
                accessToken={accessToken}
                initial={identityCheck}
                onVerified={onVerified}
                onDecline={onDecline}
            />

            <Space>
                <Button onClick={onBack}>Back to the document</Button>
            </Space>
        </div>
    );
};
