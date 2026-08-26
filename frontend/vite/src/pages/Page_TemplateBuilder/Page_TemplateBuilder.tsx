import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { App, Button, Dropdown, Input, Modal, Result, Spin, Typography, theme } from "antd";
import {
    ArrowLeftOutlined,
    FieldTimeOutlined,
    HistoryOutlined,
    MoreOutlined,
    SaveOutlined,
} from "@ant-design/icons";
import {
    App_EnvelopeScheduleEditor,
    utils_Envelope_ScheduleNow,
} from "@/components/envelopes/App_EnvelopeScheduleEditor";
import { App_TemplateFieldWorkspace } from "@/components/templates/App_TemplateFieldWorkspace";
import { App_TemplateVersionsModal } from "@/components/templates/App_TemplateVersionsModal";
import {
    utils_Templates_MigrateLayout,
    utils_Templates_MigrateSignerRoles,
} from "@/components/templates/utils_Templates_MigrateLayout";
import { Store_VerticalNav_Actions, Store_VerticalNav } from "@/stores/Store_VerticalNav";
import { useQ_Tables_Template } from "@/hooks/useQ_Tables_Template";
import { useQ_Template_PdfReadUrl } from "@/hooks/useQ_Template_PdfReadUrl";
import { useM_Template_SaveLayout } from "@/hooks/useM_Template_SaveLayout";
import { useM_Template_UploadPdf } from "@/hooks/useM_Template_UploadPdf";
import type { SignerRole, TemplateLayout } from "@/types/template.types";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";
import { useQ_Tables_MyCapabilities } from "@/hooks/useQ_Tables_MyCapabilities";

// The template builder as a full page — the successor to `App_FormBuilderModal`.
//
// The v1 builder was a modal that carried two template kinds (TipTap and PDF)
// side by side, a field palette fed by `employee_columns`, and three parallel key
// sets it folded into the layout at save time. All of that is gone: one kind, an
// intrinsic field-type palette, and roles + `required` stored directly on each
// field.
//
// What this page owns is the state the builder pieces share — layout, roles,
// selection, the pending source PDF, and the dirty baseline — plus the one save
// path. `App_TemplateBuilder` holds the canvas; it takes no queries and writes
// nothing.

export const Page_TemplateBuilder = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const { organizationId, templateId } = useParams({
        from: "/_protected/$organizationId/templates/$templateId",
    });

    const qTemplate = useQ_Tables_Template({ templateId });
    const qCaps = useQ_Tables_MyCapabilities({ organizationId });
    const mSaveLayout = useM_Template_SaveLayout({ templateId });
    const mUploadPdf = useM_Template_UploadPdf();

    const [name, setName] = useState("");
    const [layout, setLayout] = useState<TemplateLayout>([]);
    const [signerRoles, setSignerRoles] = useState<SignerRole[]>([]);
    const [pdfFilePath, setPdfFilePath] = useState<string | null>(null);
    /** Picked but not uploaded. Held in memory so discarding the page leaves no
     *  orphan R2 object — the upload runs inside Save, not on pick. */
    const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [defaultsOpen, setDefaultsOpen] = useState(false);
    const [isSaving, setSaving] = useState(false);

    // Bumped whenever the DOCUMENT is replaced wholesale — initial hydration and
    // a version restore. Used as the workspace's `key`, which remounts it and so
    // clears the selection, the highlighted role and any armed field drop.
    //
    // Those three used to be reset by hand here. They now live inside
    // `App_TemplateFieldWorkspace`, and reaching back in to clear them would mean
    // handing this page setters for state it does not own — a remount says the
    // same thing in one line and cannot fall out of sync when the workspace grows
    // a fourth piece of interaction state.
    const [workspaceEpoch, setWorkspaceEpoch] = useState(0);

    // Sending defaults (CG-013). They belong to the template rather than to one
    // send — "an NDA lapses in 14 days, a lease offer in 3" is a property of the
    // document kind — and the composer seeds itself from them.
    const [defaultExpiryDays, setDefaultExpiryDays] = useState<number | null>(null);
    const [defaultReminderDays, setDefaultReminderDays] = useState<number[]>([]);

    // Reclaim the app shell's 240px nav for the canvas while the builder is open.
    //
    // This is a global store write from one page, so it RESTORES what it found on
    // unmount rather than assuming the nav was open. Without that, leaving the
    // builder would leave the nav mysteriously collapsed everywhere else, and the
    // user would have no idea which page did it. Reads the store imperatively —
    // subscribing would re-run this effect every time the user toggled the nav
    // by hand and fight them for control of it.
    useEffect(() => {
        const previous = Store_VerticalNav.state.collapsed;
        Store_VerticalNav_Actions.setCollapsed(true);
        return () => Store_VerticalNav_Actions.setCollapsed(previous);
    }, []);

    // Hydration baseline. `hydratedIdRef` guards against re-running when the query
    // refetches — a background refetch must not discard unsaved edits.
    const hydratedIdRef = useRef<string | null>(null);
    const baselineRef = useRef("");

    // The dirty baseline covers everything ONE SAVE writes, which as of CG-013
    // includes the sending defaults. Leaving them out would mean changing a
    // deadline default and finding Save greyed out.
    const snapshot = useCallback(
        (
            n: string,
            l: TemplateLayout,
            r: SignerRole[],
            p: string | null,
            expiryDays: number | null,
            reminderDays: number[]
        ) =>
            JSON.stringify({
                name: n,
                layout: l,
                signerRoles: r,
                pdfFilePath: p,
                expiryDays,
                reminderDays,
            }),
        []
    );

    const hydrate = useCallback(
        (source: {
            name: string;
            layout: unknown;
            signer_roles: unknown;
            pdf_file_path: string | null;
            default_expiry_days: number | null;
            default_reminder_days: number[] | null;
        }) => {
            const nextLayout = utils_Templates_MigrateLayout(source.layout);
            const nextRoles = utils_Templates_MigrateSignerRoles(source.signer_roles);
            const nextReminders = source.default_reminder_days ?? [];
            setName(source.name);
            setLayout(nextLayout);
            setSignerRoles(nextRoles);
            setPdfFilePath(source.pdf_file_path);
            setDefaultExpiryDays(source.default_expiry_days);
            setDefaultReminderDays(nextReminders);
            setPendingPdfFile(null);
            setWorkspaceEpoch((n) => n + 1);
            baselineRef.current = snapshot(
                source.name,
                nextLayout,
                nextRoles,
                source.pdf_file_path,
                source.default_expiry_days,
                nextReminders
            );
        },
        [snapshot]
    );

    useEffect(() => {
        const template = qTemplate.template;
        if (!template) return;
        if (hydratedIdRef.current === template.id) return;
        hydratedIdRef.current = template.id;
        hydrate(template);
    }, [qTemplate.template, hydrate]);

    const isDirty =
        !!qTemplate.template &&
        (!!pendingPdfFile ||
            snapshot(
                name,
                layout,
                signerRoles,
                pdfFilePath,
                defaultExpiryDays,
                defaultReminderDays
            ) !== baselineRef.current);

    // Leaving with unsaved work is the one destructive action on this page that
    // nothing else guards — Save is explicit, but navigation is not.
    useBlocker({
        shouldBlockFn: () => {
            if (!isDirty) return false;
            return !window.confirm(
                "You have unsaved changes to this template. Leave without saving?"
            );
        },
        enableBeforeUnload: () => isDirty,
    });

    // A blob URL for the pending file takes precedence over the saved key, so the
    // canvas shows the PDF being placed against before it exists in R2.
    const pdfBlobUrl = useMemo(
        () => (pendingPdfFile ? URL.createObjectURL(pendingPdfFile) : null),
        [pendingPdfFile]
    );
    useEffect(() => {
        if (!pdfBlobUrl) return;
        return () => URL.revokeObjectURL(pdfBlobUrl);
    }, [pdfBlobUrl]);

    const qPdfReadUrl = useQ_Template_PdfReadUrl({
        templateId,
        pdfFilePathKey: pendingPdfFile ? null : pdfFilePath,
    });
    const pdfFileUrl = pdfBlobUrl ?? qPdfReadUrl.url ?? null;

    const hasPdf = !!pendingPdfFile || !!pdfFilePath;

    const handleSave = async () => {
        if (!name.trim()) {
            message.error("Give the template a name before saving");
            return;
        }
        if (isSaving) return;
        setSaving(true);
        try {
            // Upload first, then fold the resulting key into the same UPDATE as the
            // layout — one statement, one version row, and the version's
            // `pdf_file_path` always matches the layout that was placed on it.
            let nextPdfFilePath = pdfFilePath;
            if (pendingPdfFile) {
                const uploaded = await mUploadPdf.mutation.mutateAsync({
                    templateId,
                    file: pendingPdfFile,
                });
                nextPdfFilePath = uploaded.r2_key;
            }
            await mSaveLayout.mutation.mutateAsync({
                name: name.trim(),
                layout,
                signer_roles: signerRoles,
                pdf_file_path: nextPdfFilePath,
                default_expiry_days: defaultExpiryDays,
                default_reminder_days: defaultReminderDays,
            });
            setPdfFilePath(nextPdfFilePath);
            setPendingPdfFile(null);
            baselineRef.current = snapshot(
                name.trim(),
                layout,
                signerRoles,
                nextPdfFilePath,
                defaultExpiryDays,
                defaultReminderDays
            );
            message.success("Template saved");
        } catch (err) {
            // Both mutations already surface their own message; this keeps a failed
            // save from silently looking like a successful one.
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleBack = () =>
        navigate({ to: "/$organizationId/templates", params: { organizationId } });

    const handleRolesChange = useCallback((next: SignerRole[]) => setSignerRoles(next), []);

    const handleRestored = useCallback(
        (body: {
            layout: TemplateLayout;
            signer_roles: SignerRole[];
            pdf_file_path: string | null;
        }) => {
            // The restore already wrote a new version, so the restored content IS the
            // saved state — reset the baseline with it rather than marking the page dirty.
            setLayout(body.layout);
            setSignerRoles(body.signer_roles);
            setPdfFilePath(body.pdf_file_path);
            setPendingPdfFile(null);
            setWorkspaceEpoch((n) => n + 1);
            baselineRef.current = snapshot(
                name,
                body.layout,
                body.signer_roles,
                body.pdf_file_path,
                defaultExpiryDays,
                defaultReminderDays
            );
        },
        [name, snapshot, defaultExpiryDays, defaultReminderDays]
    );

    const handleOpenHistory = () => {
        if (!isDirty) {
            setHistoryOpen(true);
            return;
        }
        modal.confirm({
            title: "Unsaved changes",
            content:
                "Restoring a version replaces what is on the canvas. Your unsaved edits will be lost.",
            okText: "Open history anyway",
            cancelText: "Cancel",
            onOk: () => setHistoryOpen(true),
        });
    };

    if (qTemplate.query.isLoading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: token.paddingXL }}>
                <Spin size="large" />
            </div>
        );
    }

    if (!qTemplate.template) {
        return (
            <div style={{ padding: token.paddingLG }}>
                <Typography.Title level={5}>Template not found</Typography.Title>
                <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                    Back to templates
                </Button>
            </div>
        );
    }

    // CG-027. This page is an EDITOR — every control on it writes, from the name
    // field to the field canvas — so there is no useful read-only version of it
    // to offer. A member who can see the library but not change it gets the
    // library, where the card already reports name, field and role counts.
    //
    // Checked after the template loads, deliberately: "not found" and "not
    // yours to edit" are different answers and a member typing a URL for a
    // template in another organization should still get the first one.
    if (!qCaps.canManageTemplates && qCaps.query.isSuccess) {
        return (
            <Result
                status="403"
                title="You can't edit templates"
                subTitle="Your account can view this organization's templates but not change them. An admin or the owner can grant you permission from the People page."
                extra={
                    <Button type="primary" icon={<ArrowLeftOutlined />} onClick={handleBack}>
                        Back to templates
                    </Button>
                }
            />
        );
    }

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Toolbar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    padding: `0 ${isMobile ? token.paddingSM : token.paddingMD}px`,
                    // 48 is a FLOOR on mobile, not a fixed height: this row renders
                    // above the workspace's small-screen gate, so it is the one part
                    // of the builder a phone always sees, and it must be allowed to
                    // wrap rather than push the page sideways.
                    height: isMobile ? "auto" : 48,
                    minHeight: 48,
                    flexWrap: isMobile ? "wrap" : "nowrap",
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgContainer,
                }}
            >
                <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} />
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Template name"
                    variant="borderless"
                    style={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                />
                {isDirty && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Unsaved changes
                    </Typography.Text>
                )}

                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: token.marginXS,
                    }}
                >
                    {/* A modal rather than a rail section: these two controls are
                        touched once when a template is created and then never
                        again, and giving them permanent screen space would cost
                        the field palette room on every single edit.

                        On a phone they collapse further, into a `…` menu. Both are
                        occasional, and the row has room for exactly one labelled
                        button — which has to be Save, the only one whose absence
                        loses work. */}
                    {isMobile ? (
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    {
                                        key: "defaults",
                                        icon: <FieldTimeOutlined />,
                                        label: "Defaults",
                                        onClick: () => setDefaultsOpen(true),
                                    },
                                    {
                                        key: "history",
                                        icon: <HistoryOutlined />,
                                        label: "History",
                                        onClick: handleOpenHistory,
                                    },
                                ],
                            }}
                        >
                            <Button icon={<MoreOutlined />} />
                        </Dropdown>
                    ) : (
                        <>
                            <Button
                                icon={<FieldTimeOutlined />}
                                onClick={() => setDefaultsOpen(true)}
                            >
                                Defaults
                            </Button>
                            <Button icon={<HistoryOutlined />} onClick={handleOpenHistory}>
                                History
                            </Button>
                        </>
                    )}
                    <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        loading={isSaving}
                        disabled={!isDirty || !name.trim()}
                        onClick={handleSave}
                    >
                        Save
                    </Button>
                </div>
            </div>

            {/* The workspace itself now lives in `App_TemplateFieldWorkspace`,
                shared with the envelope composer's upload path (CG-017). What stays
                here is what only a TEMPLATE has: a name, a dirty baseline, version
                history, sending defaults, and Save. */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", padding: token.paddingSM }}>
                <App_TemplateFieldWorkspace
                    key={workspaceEpoch}
                    pdfFileUrl={pdfFileUrl}
                    hasPdf={hasPdf}
                    layout={layout}
                    onLayoutChange={setLayout}
                    signerRoles={signerRoles}
                    onSignerRolesChange={handleRolesChange}
                    onPendingPdfFileChange={setPendingPdfFile}
                />
            </div>

            <Modal
                open={defaultsOpen}
                title="Sending defaults"
                onCancel={() => setDefaultsOpen(false)}
                // No OK/Cancel semantics: the edits land in page state and are
                // written by the page's one Save, so a "Save" here would either
                // mint a second version row or lie about having persisted.
                footer={null}
                destroyOnHidden
                {...Utils_Modal_Responsive(isMobile)}
            >
                <Typography.Paragraph type="secondary">
                    Applied to every document sent from this template. The sender can change them
                    for an individual send, and doing so never affects documents already in flight.
                </Typography.Paragraph>
                <App_EnvelopeScheduleEditor
                    asDefaults
                    value={{ expiresAt: null, reminderDays: defaultReminderDays }}
                    // Only the reminder half is meaningful here — the deadline
                    // arrives through `onExpiryDaysChange`, because a template has
                    // no send date to hang an absolute one off.
                    onChange={(patch) => {
                        if (patch.reminderDays !== undefined) {
                            setDefaultReminderDays(patch.reminderDays);
                        }
                    }}
                    sentAt={utils_Envelope_ScheduleNow()}
                    expiryDays={defaultExpiryDays}
                    onExpiryDaysChange={setDefaultExpiryDays}
                />
            </Modal>

            <App_TemplateVersionsModal
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                templateId={templateId}
                currentPdfFilePath={pdfFilePath}
                onRestored={handleRestored}
            />
        </div>
    );
};
