import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, Empty, Input, Space, Switch, Table, Tooltip, Typography, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AuditOutlined, DownloadOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import { useQ_Tables_Envelopes, type Tables_Envelopes_Record } from "@/hooks/useQ_Tables_Envelopes";
import { useM_Envelope_DownloadSigned } from "@/hooks/useM_Envelope_DownloadSigned";
import { useM_Envelope_CertificateOpen } from "@/hooks/useM_Envelope_CertificateOpen";

// The archive — finished documents, and how to get a copy of one.
//
// WHY THIS IS NOT `Page_Envelopes` WITH A FILTER. That page is a WORKFLOW view:
// it answers "what is stuck", defaults to what is in flight, and its columns are
// about progress — who we are waiting on, how long it has been, when it expires.
// This answers a different question entirely — "find the signed copy of the thing
// we agreed in March" — and its columns are about the artifact. Same rows,
// opposite question. Folding them together behind a toggle makes both worse: the
// workflow view grows columns that are blank for everything it cares about, and
// the archive inherits a default that hides everything it is for.
//
// WHY IT READS ENVELOPES AND NOT `files`. An envelope's PDFs are server-written
// keys on the request row, not `files` rows — `envelopes_document-url`'s header
// states the rule and CG-037 deliberately kept the key columns as the evidentiary
// anchor. `useQ_Tables_OrgFiles` exists but has no callers and describes an HR-era
// surface that was deleted in v1.0; pointing this page at it would list avatars
// and template sources and miss every signed document.
//
// READ-ONLY. No upload, no delete, no folders. Storing arbitrary documents is a
// different feature with its own quota and retention questions, and retention is
// deliberately out of scope until the target jurisdiction is named.
//
// It reuses the SAME query as the list and the dashboard, so it costs no new
// backend, no new RLS surface and no second definition of what an envelope is.

/** Terminal states. A document that ended without signatures is still a record. */
const ENDED = new Set(["declined", "expired", "cancelled"]);

export const Page_Archive = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const { organizationId } = useParams({ from: "/_protected/$organizationId/archive/" });

    const [search, setSearch] = useState("");
    const [includeEnded, setIncludeEnded] = useState(false);

    // `status: 'all'` and filter here rather than asking the server twice: the
    // toggle flips between two subsets of one result set, and a refetch per flip
    // would make an instant client-side switch wait on a round trip.
    const qEnvelopes = useQ_Tables_Envelopes({ organizationId, status: "all" });
    const mDownload = useM_Envelope_DownloadSigned();
    const mCertificate = useM_Envelope_CertificateOpen();

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return qEnvelopes.envelopes
            .filter((e) => e.status === "completed" || (includeEnded && ENDED.has(e.status)))
            .filter((e) => {
                if (!needle) return true;
                if (e.title.toLowerCase().includes(needle)) return true;
                return e.signature_request_signers.some(
                    (s) =>
                        s.signer_name.toLowerCase().includes(needle) ||
                        s.signer_email.toLowerCase().includes(needle)
                );
            })
            .sort((a, b) =>
                // Newest finished first. `completed_at` is null for the ended
                // states, so fall back to `updated_at` rather than sorting every
                // declined document to one end of the list.
                (b.completed_at ?? b.updated_at ?? "").localeCompare(
                    a.completed_at ?? a.updated_at ?? ""
                )
            );
    }, [qEnvelopes.envelopes, search, includeEnded]);

    const columns: ColumnsType<Tables_Envelopes_Record> = [
        {
            title: "Document",
            dataIndex: "title",
            render: (title: string, row) => (
                <Typography.Text strong ellipsis style={{ maxWidth: 320, display: "block" }}>
                    {title}
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {row.signature_request_signers.length}{" "}
                        {row.signature_request_signers.length === 1 ? "party" : "parties"}
                    </Typography.Text>
                </Typography.Text>
            ),
        },
        {
            title: "Status",
            dataIndex: "status",
            width: 130,
            render: (status: Tables_Envelopes_Record["status"]) => (
                <App_EnvelopeStatusTag status={status} />
            ),
        },
        {
            title: "Finished",
            dataIndex: "completed_at",
            width: 170,
            responsive: ["md"],
            render: (_: unknown, row) => {
                const when = row.completed_at ?? row.updated_at;
                return when ? (
                    new Date(when).toLocaleDateString()
                ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                );
            },
        },
        {
            title: "",
            key: "actions",
            width: isMobile ? 96 : 220,
            align: "right",
            render: (_: unknown, row) => {
                // Only a COMPLETED document has a signed artifact or a
                // certificate to summarise. Declined and expired rows are here
                // as records, and offering buttons that would 404 is worse than
                // offering none.
                if (row.status !== "completed") {
                    return (
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            no signed copy
                        </Typography.Text>
                    );
                }
                return (
                    <Space size="small">
                        <Tooltip title="Download the signed PDF. Recorded in the audit trail.">
                            <Button
                                size="small"
                                icon={<DownloadOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    mDownload.mutation.mutate({
                                        organization_id: organizationId,
                                        envelope_id: row.id,
                                    });
                                }}
                            >
                                {isMobile ? null : "Signed PDF"}
                            </Button>
                        </Tooltip>
                        <Tooltip title="Certificate of Completion — every party, how each proved who they were, and the full audit trail.">
                            <Button
                                size="small"
                                icon={<AuditOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    mCertificate.mutation.mutate({
                                        organization_id: organizationId,
                                        envelope_id: row.id,
                                    });
                                }}
                            >
                                {isMobile ? null : "Certificate"}
                            </Button>
                        </Tooltip>
                    </Space>
                );
            },
        },
    ];

    return (
        <div
            style={{
                height: "100%",
                overflow: "auto",
                padding: isMobile ? token.paddingSM : token.paddingLG,
            }}
        >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                <Typography.Title level={4} style={{ marginTop: 0 }}>
                    Archive
                </Typography.Title>
                <Typography.Paragraph type="secondary">
                    Every document that has finished, and the copies you can hand to someone else.
                </Typography.Paragraph>

                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: token.marginSM,
                        marginBottom: token.marginMD,
                    }}
                >
                    <Input.Search
                        allowClear
                        placeholder="Search by document or party"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ maxWidth: 360 }}
                    />
                    <Space size="small">
                        <Switch
                            size="small"
                            checked={includeEnded}
                            onChange={setIncludeEnded}
                            id="archive-include-ended"
                        />
                        <label
                            htmlFor="archive-include-ended"
                            style={{ color: token.colorTextSecondary, cursor: "pointer" }}
                        >
                            Include declined, expired and voided
                        </label>
                    </Space>
                </div>

                <Table
                    rowKey="id"
                    size="middle"
                    loading={qEnvelopes.query.isLoading}
                    columns={columns}
                    dataSource={rows}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    onRow={(row) => ({
                        style: { cursor: "pointer" },
                        onClick: () =>
                            navigate({
                                to: "/$organizationId/envelopes/$envelopeId",
                                params: { organizationId, envelopeId: row.id },
                            }),
                    })}
                    locale={{
                        emptyText: (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    search
                                        ? "No finished document matches that search"
                                        : "Nothing has finished yet"
                                }
                            />
                        ),
                    }}
                />
            </div>
        </div>
    );
};
