import { useCallback, useEffect, useRef } from "react";
import { Button, Input, Tag, Typography, theme } from "antd";
import { CloseOutlined, SendOutlined } from "@ant-design/icons";
import { App_SigningAssistantMessage } from "./App_SigningAssistantMessage";
import { utils_SigningAssistant_NormalizeAnswer } from "./utils_SigningAssistant_NormalizeAnswer";
import { utils_SigningAssistant_StarterQuestions } from "./utils_SigningAssistant_StarterQuestions";
import { useM_Signing_Ask } from "@/hooks/useM_Signing_Ask";
import type { Signing_Error, Signing_Session } from "@/hooks/useQ_Signing_Session";
import {
    Store_SigningAssistant_Actions,
    useStore_SigningAssistant_Cooldown,
    useStore_SigningAssistant_Disabled,
    useStore_SigningAssistant_Turns,
    useStore_SigningAssistant_TurnsRemaining,
} from "@/stores/Store_SigningAssistant";

/**
 * The assistant's one body — CG-049.
 *
 * ONE BODY, TWO HOSTS: `variant="rail"` on a wide screen and `variant="drawer"`
 * inside a `Drawer` elsewhere. The host is chosen by the consumer
 * (`PageSign_Assistant`), which is the `App_NotificationPanel` pattern — a
 * component that picks its own container cannot be reused in the other one.
 *
 * STREAMING IS DEFERRED, AND THIS IS THE DECISION RATHER THAN AN OMISSION.
 * `functions.invoke` returns a parsed body, so streaming would mean hand-rolling
 * `fetch` — and that loses `utils_Signing_UnwrapError`, which is what carries
 * `retry_after_seconds` off a 429. A countdown the signer can see is worth more
 * than tokens appearing one at a time on answers that are, by design, short.
 *
 * A11y: the transcript is a `role="log"` with `aria-live="polite"`, so an answer
 * is announced without stealing focus from a half-typed question. The rail is an
 * `<aside>` and MUST NOT trap focus — it sits beside the document, not over it.
 * There is deliberately NO Esc handler on the rail: Esc while typing must not
 * destroy a half-written question.
 */

type Props = {
    variant: "rail" | "drawer";
    session: Signing_Session;
    accessToken: string;
    onGoToPage: (page: number) => void;
    /** Rail only — the drawer has its own close affordance. */
    onClose?: () => void;
};

export const App_SigningAssistantPanel = ({
    variant,
    session,
    accessToken,
    onGoToPage,
    onClose,
}: Props) => {
    const { token } = theme.useToken();
    const turns = useStore_SigningAssistant_Turns();
    const turnsRemaining = useStore_SigningAssistant_TurnsRemaining();
    const cooldown = useStore_SigningAssistant_Cooldown();
    const disabled = useStore_SigningAssistant_Disabled();
    const mAsk = useM_Signing_Ask();

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const draftRef = useRef("");
    const bottomRef = useRef<HTMLDivElement>(null);

    // One interval, driven off the value rather than a timestamp — the same
    // shape `App_SigningOtpGate` uses, because the only thing it feeds is a
    // disabled state and a label.
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => Store_SigningAssistant_Actions.tickCooldown(), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [turns.length]);

    const handleAsk = useCallback(
        async (question: string) => {
            const trimmed = question.trim();
            if (!trimmed || disabled || cooldown > 0 || mAsk.mutation.isPending) return;

            const id = `${Date.now()}-${turns.length}`;
            Store_SigningAssistant_Actions.askStart(id, trimmed);
            draftRef.current = "";
            if (inputRef.current) inputRef.current.value = "";

            try {
                const result = await mAsk.mutation.mutateAsync({
                    access_token: accessToken,
                    question: trimmed,
                });
                const normalized = utils_SigningAssistant_NormalizeAnswer(result);

                if (!normalized) {
                    Store_SigningAssistant_Actions.askResolve(id, {
                        state: "error",
                        error: "That answer didn't come back in a form I can show. Try asking again.",
                    });
                    return;
                }

                Store_SigningAssistant_Actions.askResolve(id, {
                    state: "ok",
                    answer: normalized.answer,
                    bullets: normalized.bullets,
                    citations: normalized.citations,
                    grounded: normalized.grounded,
                });
                Store_SigningAssistant_Actions.setTurnsRemaining(normalized.turnsRemaining);
            } catch (err) {
                const signingError = err as Signing_Error;

                // A 429 arrives here carrying its countdown. Rendered NEXT TO THE
                // DISABLED CONTROL rather than as a toast — a toast about a
                // button is gone before the signer looks back at the button.
                if (typeof signingError.retry_after_seconds === "number") {
                    Store_SigningAssistant_Actions.setCooldown(signingError.retry_after_seconds);
                }

                // A 401 disables the composer and says so. It does NOT navigate
                // and does NOT clear the session query: the assistant is a
                // courtesy and must never take over the page a signature is on.
                if (signingError.message?.includes("no longer valid")) {
                    Store_SigningAssistant_Actions.setDisabled(true);
                }

                Store_SigningAssistant_Actions.askResolve(id, {
                    state: "error",
                    error: signingError.message || "Something went wrong. Try asking again.",
                });
            }
        },
        [accessToken, cooldown, disabled, mAsk.mutation, turns.length]
    );

    const starters = utils_SigningAssistant_StarterQuestions(session);
    const composerDisabled = disabled || cooldown > 0 || mAsk.mutation.isPending;

    return (
        <aside
            aria-label="Document assistant"
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                minWidth: 0,
                gap: token.marginXS,
                ...(variant === "rail"
                    ? {
                          borderInlineStart: `1px solid ${token.colorBorderSecondary}`,
                          paddingInlineStart: token.paddingSM,
                      }
                    : {}),
            }}
        >
            {variant === "rail" && (
                <div style={{ display: "flex", alignItems: "center", gap: token.marginXS }}>
                    <Typography.Text strong style={{ flex: 1 }}>
                        Ask about this document
                    </Typography.Text>
                    {typeof turnsRemaining === "number" && turnsRemaining <= 5 && (
                        <Tag style={{ marginInlineEnd: 0 }}>{turnsRemaining} left</Tag>
                    )}
                    {onClose && (
                        <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={onClose}
                        />
                    )}
                </div>
            )}

            {/* NOT AN `Alert` (dismissible) AND NOT A MODAL (clicked past once,
                never seen again). The one sentence that must never go missing is
                pinned here, above the composer, for the life of the panel. */}
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                AI-generated from this document. Not legal advice — read the document before you
                sign. Your questions aren&rsquo;t shared with the sender.
            </Typography.Text>

            <div
                role="log"
                aria-live="polite"
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: token.marginSM,
                    paddingBlock: token.paddingXS,
                }}
            >
                {turns.length === 0 ? (
                    // No `Empty` illustration: on a panel this narrow it reads as
                    // "broken", not as "nothing yet".
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                        <Typography.Text type="secondary">
                            Ask anything about this document and I&rsquo;ll answer from the text,
                            quoting the line I got it from.
                        </Typography.Text>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: token.marginXXS,
                            }}
                        >
                            {starters.map((starter) => (
                                <Button
                                    key={starter}
                                    size="small"
                                    disabled={composerDisabled}
                                    onClick={() => handleAsk(starter)}
                                >
                                    {starter}
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : (
                    turns.map((turn) => (
                        <App_SigningAssistantMessage
                            key={turn.id}
                            turn={turn}
                            onGoToPage={onGoToPage}
                        />
                    ))
                )}
                <div ref={bottomRef} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
                <div style={{ display: "flex", gap: token.marginXS, alignItems: "flex-end" }}>
                    <Input.TextArea
                        ref={(node) => {
                            inputRef.current = node?.resizableTextArea?.textArea ?? null;
                        }}
                        placeholder={
                            disabled
                                ? "This link can no longer be used to ask questions"
                                : "Ask a question…"
                        }
                        disabled={disabled}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        onChange={(event) => {
                            draftRef.current = event.target.value;
                        }}
                        onPressEnter={(event) => {
                            if (event.shiftKey) return;
                            event.preventDefault();
                            handleAsk(draftRef.current);
                        }}
                    />
                    <Button
                        type="primary"
                        icon={<SendOutlined />}
                        loading={mAsk.mutation.isPending}
                        disabled={composerDisabled}
                        onClick={() => handleAsk(draftRef.current)}
                    >
                        {cooldown > 0 ? `${cooldown}s` : "Ask"}
                    </Button>
                </div>
                {cooldown > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Ask again in {cooldown}s
                    </Typography.Text>
                )}
            </div>
        </aside>
    );
};
