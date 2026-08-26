import { Button, Skeleton, Tag, Typography, theme } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import type { SigningAssistant_Turn } from "@/stores/Store_SigningAssistant";

/**
 * One exchange in the assistant panel — CG-049.
 *
 * THE FILE THAT RENDERS MODEL OUTPUT, so the defensive rendering lives here and
 * the rule is absolute: **never `dangerouslySetInnerHTML`**. React escapes by
 * default and that is the entire defence; the signing surface is the highest
 * consequence page in the product and shares an origin with the signing session.
 *
 * WHICH IS WHY THE WIRE FORMAT IS CONSTRAINED JSON AND NOT MARKDOWN. Markdown to
 * HTML means either raw HTML injection over LLM output, or two new dependencies
 * — and "so the model can emit **bold**" does not pay for either. JSON also
 * makes a citation DATA (`page` as an integer, not a regex over "(p. 4)") and a
 * refusal a BRANCH rather than a substring match on "I couldn't find".
 *
 * A REFUSAL READS AS AN ANSWER, NOT AN ERROR. `grounded: false` renders in a
 * normal bubble with a muted tag. A signer who asked something the document does
 * not cover has not done anything wrong, and a red alert would say they had.
 */

type Props = {
    turn: SigningAssistant_Turn;
    onGoToPage: (page: number) => void;
};

export const App_SigningAssistantMessage = ({ turn, onGoToPage }: Props) => {
    const { token } = theme.useToken();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
            {/* The question stays on screen while the answer is pending — a
                composer that clears itself into a spinner leaves the signer
                unsure whether it sent. */}
            <div
                style={{
                    alignSelf: "flex-end",
                    maxWidth: "90%",
                    background: token.colorFillSecondary,
                    borderRadius: token.borderRadiusLG,
                    padding: `${token.paddingXS}px ${token.paddingSM}px`,
                }}
            >
                <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                    {turn.question}
                </Typography.Text>
            </div>

            <div
                style={{
                    alignSelf: "flex-start",
                    maxWidth: "100%",
                    width: "100%",
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                    padding: token.paddingSM,
                    background: token.colorBgContainer,
                }}
            >
                {/* The skeleton lives INSIDE the answer bubble rather than
                    replacing the panel, so the thread does not jump. */}
                {turn.state === "pending" && (
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                )}

                {turn.state === "error" && (
                    <Typography.Text type="secondary">{turn.error}</Typography.Text>
                )}

                {turn.state === "ok" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                        {turn.grounded === false && (
                            <Tag
                                color="default"
                                style={{ alignSelf: "flex-start", marginInlineEnd: 0 }}
                            >
                                Not found in this document
                            </Tag>
                        )}

                        <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                            {turn.answer}
                        </Typography.Paragraph>

                        {!!turn.bullets?.length && (
                            <ul style={{ margin: 0, paddingInlineStart: token.paddingLG }}>
                                {turn.bullets.map((bullet, index) => (
                                    <li key={index}>
                                        <Typography.Text>{bullet}</Typography.Text>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {/* Every quote here was verified SERVER-SIDE as a literal
                            substring of the page it names. That is what makes it
                            safe to present as the document's own words. */}
                        {turn.citations?.map((citation, index) => (
                            <div
                                key={index}
                                style={{
                                    borderInlineStart: `3px solid ${token.colorBorder}`,
                                    paddingInlineStart: token.paddingSM,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: token.marginXXS,
                                }}
                            >
                                <Typography.Text type="secondary" italic>
                                    “{citation.quote}”
                                </Typography.Text>
                                {citation.page > 0 && (
                                    <Button
                                        type="link"
                                        size="small"
                                        icon={<FileTextOutlined />}
                                        style={{ alignSelf: "flex-start", paddingInline: 0 }}
                                        onClick={() => onGoToPage(citation.page)}
                                    >
                                        Page {citation.page}
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
