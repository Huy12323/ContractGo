import { useState } from "react";
import { Button, Card, Empty, Popconfirm, Spin, Tag, Tooltip, Typography, theme } from "antd";
import { DeleteOutlined, PlusOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { App_SignatureImage } from "@/components/signing/App_SignatureImage";
import { App_SignatureAddModal } from "@/components/profile/App_SignatureAddModal";
import { useQ_Tables_MySignatures } from "@/hooks/useQ_Tables_MySignatures";
import { useM_Signatures_Delete } from "@/hooks/useM_Signatures_Delete";
import { useM_Signatures_SetDefault } from "@/hooks/useM_Signatures_SetDefault";

type Props = {
    /** Pre-fills the typed mode in the add modal. */
    defaultTypedName?: string;
};

/** `drawn` → `Drawn`. Display-only formatting of the capture_method enum. */
const formatMethod = (method: string) => method.charAt(0).toUpperCase() + method.slice(1);

/**
 * The saved signature library (CG-029).
 *
 * A card grid rather than a list because the content IS an image — the thing a
 * user picks by is what the mark looks like, and a row of text with a thumbnail
 * makes them read where they could recognise.
 *
 * The default is marked rather than merely ordered first. The signing screen
 * preselects it, so which one is default is a fact with a consequence elsewhere,
 * and a grid that only implied it by position would make that consequence
 * invisible.
 */
export const App_SignatureLibrary = ({ defaultTypedName }: Props) => {
    const { token } = theme.useToken();
    const qSignatures = useQ_Tables_MySignatures();
    const mDelete = useM_Signatures_Delete();
    const mSetDefault = useM_Signatures_SetDefault();

    const [addOpen, setAddOpen] = useState(false);

    const addButton = (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add signature
        </Button>
    );

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: token.marginSM,
                    marginBottom: token.marginMD,
                }}
            >
                <Typography.Text type="secondary">
                    Saved signatures can be reused when you sign a document. You can still draw a
                    new one at signing time.
                </Typography.Text>
                {qSignatures.signatures.length > 0 && addButton}
            </div>

            {qSignatures.query.isLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
                    <Spin />
                </div>
            ) : qSignatures.signatures.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No saved signatures yet"
                    style={{ padding: token.paddingLG }}
                >
                    {addButton}
                </Empty>
            ) : (
                <div
                    style={{
                        display: "grid",
                        // `auto-fill` rather than a fixed column count: the grid
                        // sits in a tab that is full-width on a phone and ~800px on
                        // a desktop, and a signature card has a natural minimum.
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: token.marginMD,
                    }}
                >
                    {qSignatures.signatures.map((signature) => {
                        const isDeleting =
                            mDelete.mutation.isPending &&
                            mDelete.mutation.variables?.signature_id === signature.id;

                        return (
                            <Card
                                key={signature.id}
                                size="small"
                                style={{
                                    // The default gets a ring rather than only a tag
                                    // — it is the one the signing screen will use.
                                    borderColor: signature.is_default
                                        ? token.colorPrimary
                                        : undefined,
                                }}
                                styles={{ body: { padding: token.paddingSM } }}
                                actions={[
                                    signature.is_default ? (
                                        <Tooltip key="default" title="This is your default">
                                            <StarFilled style={{ color: token.colorPrimary }} />
                                        </Tooltip>
                                    ) : (
                                        <Tooltip key="default" title="Make default">
                                            <StarOutlined
                                                onClick={() =>
                                                    mSetDefault.mutation.mutate({
                                                        signature_id: signature.id,
                                                    })
                                                }
                                            />
                                        </Tooltip>
                                    ),
                                    <Popconfirm
                                        key="delete"
                                        title="Delete this signature?"
                                        description="Documents you already signed are not affected."
                                        okText="Delete"
                                        okButtonProps={{ danger: true }}
                                        onConfirm={() =>
                                            mDelete.mutation.mutate({ signature_id: signature.id })
                                        }
                                    >
                                        <Tooltip title="Delete">
                                            {isDeleting ? (
                                                <Spin size="small" />
                                            ) : (
                                                <DeleteOutlined />
                                            )}
                                        </Tooltip>
                                    </Popconfirm>,
                                ]}
                            >
                                <App_SignatureImage
                                    signatureId={signature.id}
                                    alt={signature.name ?? "Saved signature"}
                                />
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: token.marginXS,
                                        marginTop: token.marginXS,
                                    }}
                                >
                                    <Typography.Text
                                        ellipsis
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {signature.name ?? formatMethod(signature.capture_method)}
                                    </Typography.Text>
                                    {signature.is_default && (
                                        <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                            Default
                                        </Tag>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <App_SignatureAddModal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                defaultTypedName={defaultTypedName}
            />
        </div>
    );
};
