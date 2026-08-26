import { useCallback } from "react";
import { Button, Drawer } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { App_SigningAssistantPanel } from "@/components/signing/App_SigningAssistantPanel";
import { utils_Pdf_ScrollToPage } from "@/components/pdf/utils_Pdf_ScrollToPage";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";
import {
    Store_SigningAssistant_Actions,
    useStore_SigningAssistant_Open,
} from "@/stores/Store_SigningAssistant";

/**
 * Chooses where the assistant lives and how a citation gets to its page —
 * CG-049.
 *
 * THREE HOSTS, and the boundaries are argued rather than inherited:
 *
 *   ≥ 1200 (xl)  a persistent 380px rail beside the document.
 *   768–1199     a right-hand `Drawer` with `mask={false}` — the point of the
 *                missing mask is that the document stays visible AND scrollable
 *                behind it, which is the same non-modal reasoning
 *                `App_SigningFieldSheet` states for not being a `Drawer` at all.
 *   < 768        a bottom `Drawer`, masked.
 *
 * `xl` AND NOT `lg`. The desktop filler already owns a 260px "Your fields" rail,
 * so at 992 a 380px panel would leave the PDF about 330px — an unreadable
 * contract, which defeats the feature it is trying to help with.
 *
 * ON A PHONE "ALONGSIDE" IS A FICTION: reading a contract at 390px already needs
 * pinch-zoom. So mobile is sequential rather than simultaneous, and the `Page N`
 * citation button is the payoff — it closes the drawer AND scrolls to the clause.
 */

type Step = "welcome" | "identity" | "fill" | "sign" | "complete" | "declined";

type Props = {
    session: Signing_Session;
    accessToken: string;
    step: Step;
    /** Citations can only be shown on the step that renders the document. */
    onRequestFillStep: () => void;
};

/** The rail's width. Wide enough for a quoted clause to keep its line breaks. */
export const const_SigningAssistant_RailWidth = 380;

/**
 * Whether the assistant is available at all right now.
 *
 * ABSENT MEANS OFF — the strict default `embed_origin` and `identity_check`
 * already follow, and the one that matters here because a browser can be holding
 * a page from before this shipped.
 *
 * NOT ON `complete`: the ceremony is over and `signing_submit` has consumed the
 * token, so every ask would 401 anyway. Not on `identity` either — that step is
 * a single decision with a vendor flow attached, and a chat panel beside it is
 * noise at the least helpful possible moment.
 */
export const utils_PageSign_AssistantAvailable = (session: Signing_Session, step: Step): boolean =>
    session.assistant_enabled === true &&
    (step === "welcome" || step === "fill" || step === "sign");

export const PageSign_Assistant = ({ session, accessToken, step, onRequestFillStep }: Props) => {
    const { isMobile, isWide } = useApp_Breakpoint();
    const open = useStore_SigningAssistant_Open();

    const goToPage = useCallback(
        (page: number) => {
            if (!isWide) Store_SigningAssistant_Actions.setOpen(false);
            if (step !== "fill") onRequestFillStep();

            // The PDF renders nothing until its ResizeObserver has fired, so the
            // first attempt from `welcome` or `sign` finds no element. One retry
            // on a timer, and then it is let go: a scroll that did not happen is
            // a small disappointment, an exception on this page is not.
            if (utils_Pdf_ScrollToPage(page)) return;
            window.setTimeout(() => utils_Pdf_ScrollToPage(page), 200);
        },
        [isWide, onRequestFillStep, step]
    );

    const panel = (
        <App_SigningAssistantPanel
            variant={isWide ? "rail" : "drawer"}
            session={session}
            accessToken={accessToken}
            onGoToPage={goToPage}
            onClose={isWide ? () => Store_SigningAssistant_Actions.setOpen(false) : undefined}
        />
    );

    if (isWide) {
        if (!open) return null;
        return (
            <div style={{ width: const_SigningAssistant_RailWidth, flexShrink: 0, minHeight: 0 }}>
                {panel}
            </div>
        );
    }

    return (
        <Drawer
            open={open}
            onClose={() => Store_SigningAssistant_Actions.setOpen(false)}
            title="Ask about this document"
            placement={isMobile ? "bottom" : "right"}
            width={420}
            height={isMobile ? "calc(var(--app-vh, 1vh) * 92)" : undefined}
            // Non-modal on a tablet so the document behind stays readable and
            // scrollable while a question is being typed about it.
            mask={isMobile}
            styles={{ body: { display: "flex", flexDirection: "column", minHeight: 0 } }}
        >
            {panel}
        </Drawer>
    );
};

/**
 * The trigger.
 *
 * IN THE STEPS HEADER ROW, NOT A FLOATING BUTTON. A FAB on this page would sit
 * on top of `App_SigningFieldSheet`'s fixed bottom bar and, on the fill step,
 * over the very field boxes the signer is trying to tap.
 */
export const PageSign_AssistantTrigger = () => (
    <Button
        size="small"
        icon={<RobotOutlined />}
        onClick={() => Store_SigningAssistant_Actions.toggle()}
    >
        Ask about this
    </Button>
);
