import { useEffect, useMemo, useState } from "react";
import {
    Alert,
    App,
    Avatar,
    Button,
    Empty,
    List,
    Modal,
    Spin,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { UndoOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { App_PdfDocument } from "@/components/pdf/App_PdfDocument";
import { App_PdfFieldBox, App_PdfFieldOverlay } from "@/components/pdf/App_PdfFieldOverlay";
import { useQ_Tables_TemplateVersions } from "@/hooks/useQ_Tables_TemplateVersions";
import { useQ_Template_PdfReadUrl } from "@/hooks/useQ_Template_PdfReadUrl";
import { useM_Template_Restore } from "@/hooks/useM_Template_Restore";
import { App_RoleLegendChip } from "./App_RoleLegendChip";
import { const_TemplateRole_OrphanColor } from "./const_TemplateSignerRoleColors";
import {
    utils_Templates_MigrateLayout,
    utils_Templates_MigrateSignerRoles,
} from "./utils_Templates_MigrateLayout";
import type { SignerRole, TemplateLayout } from "@/types/template.types";
import { Utils_Avatar_Src } from "@/utils/Utils_Avatar_Src";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

dayjs.extend(relativeTime);

// Version history — replaces `App_ContractTemplateVersionsModal`.
//
// The v1 modal previewed a version by mounting `App_ContractFiller` in review
// mode, which meant version history could not render without `employee_columns`
// and `employee_column_choices` in hand to resolve every field's label and type.
// A v2 layout is self-describing, so the preview is now a read-only field overlay
// on the PDF — no filler, no HR tables, and no interaction to accidentally leave
// a "draft" the user thinks they edited.

export type App_TemplateVersionsModal_OnRestored = (body: {
    layout: TemplateLayout;
    signer_roles: SignerRole[];
    pdf_file_path: string | null;
}) => void;

type Props = {
    open: boolean;
    onClose: () => void;
    templateId: string;
    /** The template's live `pdf_file_path`, used to warn when a version was made
     *  against a different source PDF than the one that would render. */
    currentPdfFilePath: string | null;
    onRestored: App_TemplateVersionsModal_OnRestored;
};

// Thin shell — every hook lives in ModalBody, which `destroyOnHidden` unmounts on
// close, so `selectedVersionId` resets between opens with no reset effect.
export const App_TemplateVersionsModal = ({
    open,
    onClose,
    templateId,
    currentPdfFilePath,
    onRestored,
}: Props) => {
    const { isMobile } = useApp_Breakpoint();

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Version history"
            // 80vw of a 390px screen is 312px, which the 320px version rail alone
            // overflows. Near-fullscreen instead, and the two panes stack.
            {...Utils_Modal_Responsive(isMobile, "80vw")}
            footer={null}
            styles={{
                body: {
                    height: isMobile ? "calc(var(--app-vh) - 120px)" : "70vh",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    padding: 0,
                },
            }}
            destroyOnHidden
        >
            <ModalBody
                templateId={templateId}
                currentPdfFilePath={currentPdfFilePath}
                onClose={onClose}
                onRestored={onRestored}
            />
        </Modal>
    );
};

type BodyProps = {
    templateId: string;
    currentPdfFilePath: string | null;
    onClose: () => void;
    onRestored: App_TemplateVersionsModal_OnRestored;
};

const ModalBody = ({ templateId, currentPdfFilePath, onClose, onRestored }: BodyProps) => {
    const { isMobile } = useApp_Breakpoint();
    const { token } = theme.useToken();
    const { modal } = App.useApp();

    const qVersions = useQ_Tables_TemplateVersions({ templateId });
    const mRestore = useM_Template_Restore({ templateId });

    const versions = qVersions.versions;
    const latestVersionId = versions[0]?.id ?? null;

    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedVersionId && latestVersionId) setSelectedVersionId(latestVersionId);
    }, [latestVersionId, selectedVersionId]);

    const selected = useMemo(
        () => versions.find((v) => v.id === selectedVersionId) ?? null,
        [versions, selectedVersionId]
    );

    const selectedLayout = useMemo(
        () => utils_Templates_MigrateLayout(selected?.layout),
        [selected?.layout]
    );
    const selectedRoles = useMemo(
        () => utils_Templates_MigrateSignerRoles(selected?.signer_roles),
        [selected?.signer_roles]
    );

    // The read-url function signs whatever PDF the TEMPLATE currently points at —
    // it takes a template id, not an r2_key, and old source PDFs are not addressable
    // through it. Passing the version's path as the cache key keeps the preview
    // honest about which snapshot it belongs to; the banner below covers the case
    // where the rendered bytes are not the ones this version was placed against.
    const qPdfUrl = useQ_Template_PdfReadUrl({
        templateId: selected?.pdf_file_path ? templateId : null,
        pdfFilePathKey: selected?.pdf_file_path ?? null,
    });

    const pdfMismatch = !!selected?.pdf_file_path && selected.pdf_file_path !== currentPdfFilePath;

    const handleRestore = (v: (typeof versions)[number]) => {
        const layout = utils_Templates_MigrateLayout(v.layout);
        const signer_roles = utils_Templates_MigrateSignerRoles(v.signer_roles);
        modal.confirm({
            title: `Restore v${v.version_number}?`,
            content:
                "This writes the snapshot back as a new version. Any unsaved edits in the builder will be lost.",
            okText: "Restore",
            cancelText: "Cancel",
            onOk: async () => {
                await mRestore.mutation.mutateAsync({
                    layout,
                    signer_roles,
                    pdf_file_path: v.pdf_file_path,
                    versionNumber: v.version_number,
                });
                onRestored({ layout, signer_roles, pdf_file_path: v.pdf_file_path });
                onClose();
            },
        });
    };

    const formatAuthor = (profile: (typeof versions)[number]["profiles"]) =>
        profile?.full_name ?? profile?.email ?? "Unknown";

    return (
        <>
            {/* Left: version list — a top strip when the modal stacks on mobile,
                capped so the preview below it still gets most of the height. */}
            <div
                style={{
                    width: isMobile ? "100%" : 320,
                    minWidth: isMobile ? 0 : 320,
                    maxHeight: isMobile ? "40%" : undefined,
                    flexShrink: 0,
                    borderRight: isMobile ? "none" : `1px solid ${token.colorBorderSecondary}`,
                    borderBottom: isMobile ? `1px solid ${token.colorBorderSecondary}` : "none",
                    overflowY: "auto",
                }}
            >
                <List
                    loading={qVersions.query.isLoading}
                    dataSource={versions}
                    locale={{ emptyText: "No versions yet" }}
                    renderItem={(v, idx) => {
                        const isLatest = idx === 0;
                        const isSelected = v.id === selectedVersionId;
                        return (
                            <List.Item
                                onClick={() => setSelectedVersionId(v.id)}
                                style={{
                                    cursor: "pointer",
                                    padding: token.paddingSM,
                                    background: isSelected ? token.colorPrimaryBg : undefined,
                                    borderLeft: isSelected
                                        ? `3px solid ${token.colorPrimary}`
                                        : "3px solid transparent",
                                }}
                            >
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: token.marginXXS,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: token.marginXS,
                                        }}
                                    >
                                        <Typography.Text strong>
                                            v{v.version_number}
                                        </Typography.Text>
                                        <Typography.Text
                                            type="secondary"
                                            style={{ fontSize: token.fontSizeSM }}
                                        >
                                            {dayjs(v.created_at).format("YYYY-MM-DD HH:mm")}
                                        </Typography.Text>
                                        {isLatest && (
                                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                                Latest
                                            </Tag>
                                        )}
                                        {!isLatest && (
                                            <Tooltip title="Restore this version">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<UndoOutlined />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRestore(v);
                                                    }}
                                                    loading={mRestore.mutation.isPending}
                                                    style={{ marginLeft: "auto" }}
                                                >
                                                    Restore
                                                </Button>
                                            </Tooltip>
                                        )}
                                    </div>
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {dayjs(v.created_at).fromNow()}
                                    </Typography.Text>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: token.marginXS,
                                        }}
                                    >
                                        <Avatar size="small" src={Utils_Avatar_Src(v.profiles)}>
                                            {formatAuthor(v.profiles).charAt(0).toUpperCase()}
                                        </Avatar>
                                        <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                            {formatAuthor(v.profiles)}
                                        </Typography.Text>
                                    </div>
                                </div>
                            </List.Item>
                        );
                    }}
                />
            </div>

            {/* Right: read-only preview */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {!selected ? (
                    qVersions.query.isLoading ? (
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                padding: token.paddingXL,
                            }}
                        >
                            <Spin />
                        </div>
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Select a version to preview"
                            style={{ marginTop: token.marginXL }}
                        />
                    )
                ) : (
                    <>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: token.marginXS,
                                padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                                flexShrink: 0,
                            }}
                        >
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                {selectedLayout.length} field
                                {selectedLayout.length === 1 ? "" : "s"}
                            </Typography.Text>
                            <App_RoleLegendChip
                                signerRoles={selectedRoles}
                                layout={selectedLayout}
                            />
                        </div>

                        {pdfMismatch && (
                            <Alert
                                type="warning"
                                showIcon
                                banner
                                message="This version was placed against a different source PDF"
                                description="Only the template's current PDF can be rendered, so the field positions below may not line up with the pages this version was authored on."
                            />
                        )}

                        <div style={{ flex: 1, minHeight: 0 }}>
                            {!selected.pdf_file_path ? (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description="This version has no source PDF"
                                    style={{ marginTop: token.marginXL }}
                                />
                            ) : qPdfUrl.url ? (
                                <App_PdfDocument
                                    key={selected.id}
                                    fileUrl={qPdfUrl.url}
                                    overlayRenderer={({ pageNumber }) => (
                                        <App_PdfFieldOverlay
                                            pageNumber={pageNumber}
                                            isArmed={false}
                                        >
                                            {selectedLayout
                                                .filter((f) => f.page === pageNumber)
                                                .map((field) => (
                                                    <App_PdfFieldBox
                                                        key={field.id}
                                                        box={field}
                                                        borderColor={
                                                            selectedRoles.find(
                                                                (r) => r.id === field.role_id
                                                            )?.color ??
                                                            const_TemplateRole_OrphanColor
                                                        }
                                                        isSelected={false}
                                                        style={{ cursor: "default" }}
                                                    >
                                                        <Typography.Text
                                                            ellipsis
                                                            style={{
                                                                fontSize: token.fontSizeSM,
                                                                lineHeight: 1,
                                                            }}
                                                        >
                                                            {field.label}
                                                            {field.required && (
                                                                <span
                                                                    style={{
                                                                        color: token.colorError,
                                                                    }}
                                                                >
                                                                    {" "}
                                                                    *
                                                                </span>
                                                            )}
                                                        </Typography.Text>
                                                    </App_PdfFieldBox>
                                                ))}
                                        </App_PdfFieldOverlay>
                                    )}
                                />
                            ) : (
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        padding: token.paddingXL,
                                    }}
                                >
                                    <Spin />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </>
    );
};
