import { useState } from "react";
import { App, Button, Space, Typography, Upload, theme } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { useM_Files_Upload } from "@/hooks/useM_Files_Upload";
import { useM_OrgSettings_OrganizationUpdate } from "@/hooks/useM_OrgSettings_OrganizationUpdate";
import { Utils_Files_PublicUrl } from "@/utils/Utils_Files_PublicUrl";
import { MAX_UPLOAD_SIZE_BYTES } from "@/utils/const_FileUpload";

/**
 * The organization logo picker.
 *
 * Structurally a copy of `PageSettings_ProfileTab`'s avatar flow — `beforeUpload`
 * returning `false` so antd's own XHR never runs, a chained
 * `mUpload → mOrganizationUpdate`, an optimistic local preview, and its own size
 * ceiling below the app-wide one. Deliberately a copy rather than a shared
 * component: the two differ in resource type, accepted formats, authorization
 * tier and shape, and a component parameterised over all four would be harder to
 * read than either caller.
 *
 * ═══ THE FORMAT LIST IS A SECURITY CONTROL ═══
 *
 * PNG, JPEG and WebP, and NOT SVG. This object is served with no token from an
 * origin we control, and an SVG can carry script — that is stored XSS for zero
 * benefit over a PNG. The edge function refuses SVG independently; this check
 * exists so the refusal is instant and legible rather than a round trip to a 400.
 *
 * ═══ REPLACING DOES NOT DELETE THE OLD OBJECT ═══
 *
 * Same as the avatar flow. `logo_file_id` is `ON DELETE SET NULL`, so the row
 * simply points elsewhere and the previous object is orphaned in the bucket.
 * That is a known, shared gap rather than something this component invented —
 * fixing it means a sweep that covers avatars too.
 */

/** A logo renders at ~40px. Matches `MAX_LOGO_BYTES` in `files_r2_upload-start`. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const PageOrgSettingsBranding_LogoUpload = ({
    organizationId,
    logoUrl,
    disabled,
}: {
    organizationId: string;
    logoUrl: string | undefined;
    disabled: boolean;
}) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const mUpload = useM_Files_Upload();
    const { mutation: mOrganizationUpdate } = useM_OrgSettings_OrganizationUpdate({
        organizationId,
    });

    // Optimistic preview so the logo changes the moment it is chosen, rather
    // than after the organizations row round-trips.
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const currentLogo = previewUrl ?? logoUrl ?? null;

    const handleFile = (file: File) => {
        if (!ACCEPTED_TYPES.includes(file.type)) {
            message.error("Choose a PNG, JPEG or WebP image (SVG is not supported)");
            return false;
        }
        if (file.size > Math.min(MAX_LOGO_BYTES, MAX_UPLOAD_SIZE_BYTES)) {
            message.error("Logo must be under 2MB");
            return false;
        }

        mUpload.mutation.mutate(
            { resource_type: "organization_logo", file, organization_id: organizationId },
            {
                onSuccess: (result) => {
                    // Built through the same helper every other reader uses, so
                    // the preview cannot disagree with what renders after the
                    // refetch — including under `STORAGE_DRIVER=local`, where
                    // the Worker origin would be the wrong host.
                    setPreviewUrl(Utils_Files_PublicUrl(result.r2_key));
                    mOrganizationUpdate.mutate({ logo_file_id: result.file_id });
                },
            }
        );

        // `false` — the upload is driven by the mutation above, not antd's XHR.
        return false;
    };

    const isBusy = mUpload.mutation.isPending || mOrganizationUpdate.isPending;

    return (
        <Space direction="vertical" size="middle">
            <div
                style={{
                    width: 160,
                    height: 80,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px dashed ${token.colorBorder}`,
                    borderRadius: token.borderRadius,
                    background: token.colorFillQuaternary,
                    overflow: "hidden",
                }}
            >
                {currentLogo ? (
                    <img
                        src={currentLogo}
                        alt="Organization logo"
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    />
                ) : (
                    <Typography.Text type="secondary">No logo</Typography.Text>
                )}
            </div>

            <Space>
                <Upload
                    accept={ACCEPTED_TYPES.join(",")}
                    showUploadList={false}
                    beforeUpload={handleFile}
                    disabled={disabled || isBusy}
                >
                    <Button icon={<UploadOutlined />} disabled={disabled} loading={isBusy}>
                        {currentLogo ? "Replace logo" : "Upload logo"}
                    </Button>
                </Upload>

                {currentLogo && (
                    <Button
                        icon={<DeleteOutlined />}
                        disabled={disabled || isBusy}
                        onClick={() => {
                            setPreviewUrl(null);
                            mOrganizationUpdate.mutate({ logo_file_id: null });
                        }}
                    >
                        Remove
                    </Button>
                )}
            </Space>

            <Typography.Text type="secondary">
                PNG, JPEG or WebP, up to 2MB. A wide logo on a transparent background reads best —
                it appears above the signing page and at the top of every email you send.
            </Typography.Text>
        </Space>
    );
};
