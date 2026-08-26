import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { App, Button, Card, Empty, Input, Modal, Spin, Tooltip, Typography, theme } from "antd";
import {
    DeleteOutlined,
    EditOutlined,
    FilePdfOutlined,
    PlusOutlined,
    SearchOutlined,
    SendOutlined,
} from "@ant-design/icons";
import { App_PageToolbar } from "@/components/app-shell/App_PageToolbar";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";
import { useQ_Tables_Templates } from "@/hooks/useQ_Tables_Templates";
import { useQ_Tables_MyCapabilities } from "@/hooks/useQ_Tables_MyCapabilities";
import { useM_Template_Archive } from "@/hooks/useM_Template_Archive";
import { useM_Template_Create } from "@/hooks/useM_Template_Create";
import {
    const_Templates_DefaultSignerRoles,
    utils_Templates_MigrateLayout,
} from "@/components/templates/utils_Templates_MigrateLayout";

// The template library. Replaces `App_ContractTemplatesManager`'s standalone use
// (that component survives only as the onboarding wizard's picker until Phase H
// retires the wizard itself).
//
// Two things changed with the move out of a modal. Creating a template now mints
// the row up front and navigates to the builder, because the builder is a page
// and a page needs an id in its URL — the v1 modal could hold an unsaved template
// in memory precisely because it had nowhere to navigate to. And the card grid
// shows field and role counts, which a v1 template could not report without
// resolving `employee_columns` first.

export const Page_Templates = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { modal } = App.useApp();
    const navigate = useNavigate();
    const { organizationId } = useParams({ from: "/_protected/$organizationId/templates/" });

    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [createName, setCreateName] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const qTemplates = useQ_Tables_Templates({ organizationId });
    // CG-027. Every member can now READ this page; who may change what it lists
    // is a permission, not a tier. Courtesy hiding only — the RLS policies on
    // `contract_templates` are what actually refuse the write.
    const qCaps = useQ_Tables_MyCapabilities({ organizationId });
    const mArchive = useM_Template_Archive();
    const mCreate = useM_Template_Create();

    // One reason left for the create button to be dead. CG-030 removed the other
    // — "this organization has no entity to file a template under" — by making the
    // entity something the database fills in from the organization, so the state
    // that produced a dead button with no explanation is no longer expressible.
    const canManageTemplates = qCaps.canManageTemplates;
    const noPermissionMessage =
        "You don't have permission to manage templates. An admin or the owner can grant it.";
    const createBlockedReason = !canManageTemplates ? noPermissionMessage : "";

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return qTemplates.templates;
        return qTemplates.templates.filter((t) => t.name.toLowerCase().includes(q));
    }, [qTemplates.templates, search]);

    const openBuilder = useCallback(
        (templateId: string) =>
            navigate({
                to: "/$organizationId/templates/$templateId",
                params: { organizationId, templateId },
            }),
        [navigate, organizationId]
    );

    // The template id travels alone. It used to need an `entityId` beside it,
    // because the composer's template list was entity-scoped and the id by itself
    // would select nothing; CG-030 made that list organization-scoped.
    const openComposer = useCallback(
        (templateId: string) =>
            navigate({
                to: "/$organizationId/envelopes/new",
                params: { organizationId },
                search: { templateId },
            }),
        [navigate, organizationId]
    );

    const handleArchive = useCallback(
        (templateId: string, templateName: string) => {
            modal.confirm({
                title: "Archive template?",
                content: `"${templateName}" will be hidden from this list. Documents already sent from it keep working — they carry their own snapshot.`,
                okText: "Archive",
                okButtonProps: { danger: true },
                onOk: () => mArchive.mutation.mutateAsync({ templateId }),
            });
        },
        [modal, mArchive.mutation]
    );

    const handleCreate = async () => {
        const name = createName.trim();
        if (!name) return;
        const created = await mCreate.mutation.mutateAsync({
            organization_id: organizationId,
            name,
            layout: [],
            signer_roles: const_Templates_DefaultSignerRoles,
        });
        setCreateOpen(false);
        setCreateName("");
        openBuilder(created.id);
    };

    const openCreate = () => {
        setCreateName("");
        setCreateOpen(true);
    };

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <App_PageToolbar
                actions={
                    <>
                        <Input
                            placeholder="Search templates"
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            allowClear
                            // On mobile the toolbar wraps its actions onto their own
                            // full-width row, so the search fills it rather than
                            // holding a 260px column beside a button.
                            style={{
                                width: isMobile ? undefined : 260,
                                flex: isMobile ? 1 : undefined,
                            }}
                        />
                        {/* The span is required for the Tooltip to fire — antd gives a
                            disabled button `pointer-events: none`. */}
                        <Tooltip title={createBlockedReason}>
                            <span>
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    disabled={!!createBlockedReason}
                                    onClick={openCreate}
                                >
                                    {isMobile ? "New" : "New template"}
                                </Button>
                            </span>
                        </Tooltip>
                    </>
                }
            />

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                }}
            >
                {/* One gate now. The old first branch waited on the entity query
                    before trusting this one, because `useQ_Tables_Templates` was
                    `enabled: !!entityId` and read as "not loading, not populated"
                    while the entity resolved — which fell through to the empty
                    state and flashed it at every sender on every page load. Keyed
                    on the organization, the query is enabled on first render. */}
                {qTemplates.query.isLoading ? (
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "center",
                            padding: token.paddingXL,
                        }}
                    >
                        <Spin />
                    </div>
                ) : qTemplates.templates.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            canManageTemplates
                                ? "No templates yet"
                                : "No templates yet. Only people who can manage templates may add one."
                        }
                        style={{ padding: `${token.paddingXL}px 0` }}
                    >
                        {/* Offered only to somebody who can take it. An empty state
                            whose only call to action refuses on click is worse than
                            an empty state with none. */}
                        {canManageTemplates && (
                            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                Create your first template
                            </Button>
                        )}
                    </Empty>
                ) : filtered.length === 0 ? (
                    <Typography.Text type="secondary">
                        No templates match &ldquo;{search}&rdquo;
                    </Typography.Text>
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                            gap: token.marginMD,
                        }}
                    >
                        {filtered.map((t) => {
                            const layout = utils_Templates_MigrateLayout(t.layout);
                            const roleCount = Array.isArray(t.signer_roles)
                                ? t.signer_roles.length
                                : 0;
                            const isHovered = hoveredId === t.id;
                            // The card opens the BUILDER, which is an editor with no
                            // read-only mode. For somebody who cannot edit, it is inert
                            // rather than a click that lands on a refusal — the card
                            // itself already reports the name, field and role counts
                            // they can usefully see.
                            return (
                                <Card
                                    key={t.id}
                                    hoverable={canManageTemplates}
                                    onClick={
                                        canManageTemplates ? () => openBuilder(t.id) : undefined
                                    }
                                    onMouseEnter={() => setHoveredId(t.id)}
                                    onMouseLeave={() =>
                                        setHoveredId((id) => (id === t.id ? null : id))
                                    }
                                    style={{ cursor: canManageTemplates ? "pointer" : "default" }}
                                    styles={{ body: { padding: token.paddingMD } }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: token.marginSM,
                                        }}
                                    >
                                        <FilePdfOutlined
                                            style={{
                                                fontSize: 22,
                                                color: token.colorError,
                                                marginTop: 2,
                                            }}
                                        />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <Typography.Text
                                                strong
                                                ellipsis
                                                style={{ display: "block" }}
                                            >
                                                {t.name}
                                            </Typography.Text>
                                            <Typography.Text
                                                type="secondary"
                                                style={{ fontSize: token.fontSizeSM }}
                                            >
                                                {layout.length} field
                                                {layout.length === 1 ? "" : "s"} · {roleCount} role
                                                {roleCount === 1 ? "" : "s"}
                                                {!t.pdf_file_path && " · no PDF"}
                                            </Typography.Text>
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: token.marginXXS,
                                                // ALWAYS VISIBLE ON TOUCH. A phone
                                                // never fires the mouseenter these
                                                // read, and Send/Edit/Archive have no
                                                // other entry point from this page —
                                                // reveal-on-hover would hide three
                                                // features outright, not just style them.
                                                opacity: isMobile || isHovered ? 1 : 0,
                                                transition: "opacity 0.15s",
                                            }}
                                        >
                                            {/* Send and Edit are separate permissions,
                                                so they appear independently: somebody
                                                who may send from the library but not
                                                change it gets the first icon only. */}
                                            {qCaps.canSendDocuments && (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<SendOutlined />}
                                                    // Disabled without a PDF: there is
                                                    // nothing to sign, and `envelopes_send`
                                                    // would reject it after three steps of
                                                    // composing.
                                                    disabled={!t.pdf_file_path}
                                                    title="Send for signature"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openComposer(t.id);
                                                    }}
                                                />
                                            )}
                                            {canManageTemplates && (
                                                <>
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<EditOutlined />}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openBuilder(t.id);
                                                        }}
                                                    />
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        danger
                                                        icon={<DeleteOutlined />}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleArchive(t.id, t.name);
                                                        }}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            <Modal
                open={createOpen}
                title="New template"
                okText="Create and open builder"
                onOk={handleCreate}
                okButtonProps={{
                    disabled: !createName.trim(),
                    loading: mCreate.mutation.isPending,
                }}
                onCancel={() => setCreateOpen(false)}
                destroyOnHidden
                {...Utils_Modal_Responsive(isMobile)}
            >
                <Typography.Paragraph type="secondary">
                    The template is created empty. You upload its source PDF and place fields in the
                    builder.
                </Typography.Paragraph>
                <Input
                    autoFocus
                    placeholder="Template name"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onPressEnter={handleCreate}
                />
            </Modal>
        </div>
    );
};
