import { useState } from "react";
import { Avatar, Button, Form, Input, Typography, Upload, App, theme } from "antd";
import { KeyOutlined, UploadOutlined, UserOutlined } from "@ant-design/icons";
import { App_ProfilePasswordModal } from "@/components/profile/App_ProfilePasswordModal";
import type { Me_QueryData } from "@/hooks/useQ_Me";
import { useM_Files_Upload } from "@/hooks/useM_Files_Upload";
import { useM_Profile_Update } from "@/hooks/useM_Profile_Update";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "@/utils/const_FileUpload";
import { Utils_Avatar_Src, Utils_Avatar_SrcFromKey } from "@/utils/Utils_Avatar_Src";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    profile: Me_QueryData | null;
};

type InfoValues = { full_name: string };

/** Avatars are images and small; the 50MB app-wide ceiling is not a useful limit here. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * "Personal information" — the user's own name and avatar.
 *
 * Lifted from `App_ProfileInfoModal`, whose own comment anticipated this: the
 * modal body took no `open`/`onClose` of its own "so if a real account page ever
 * arrives it can render them unchanged". CG-029 is that page — a grid of
 * signature cards does not fit in a 420px modal, and once Settings exists the
 * profile form belongs beside it rather than in a dropdown.
 *
 * The PASSWORD form deliberately stays a modal, launched from here. It is a
 * three-field transaction with its own success and failure, not a section of a
 * page you scroll past, and `useM_Profile_PasswordUpdate` re-authenticates
 * mid-flow — which reads as a deliberate act in a dialog and as a surprise
 * inline.
 *
 * Email is rendered read-only for the reason the modal gave: it exists on
 * `auth.users` as well as on `profiles`, and `profiles.email_verified` gates the
 * entire `_protected` tree, so changing it is a re-verification flow rather than
 * a field on this form.
 */
export const PageSettings_ProfileTab = ({ profile }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { message } = App.useApp();
    const [form] = Form.useForm<InfoValues>();
    const mUpload = useM_Files_Upload();
    const mProfileUpdate = useM_Profile_Update();

    const [passwordOpen, setPasswordOpen] = useState(false);

    // Optimistic local preview so the avatar changes the moment it is chosen,
    // rather than after the profile row round-trips.
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const currentAvatar = avatarUrl ?? Utils_Avatar_Src(profile) ?? null;

    const handleAvatar = (file: File) => {
        if (!profile) return false;
        if (!file.type.startsWith("image/")) {
            message.error("Choose an image file");
            return false;
        }
        if (file.size > Math.min(MAX_AVATAR_BYTES, MAX_UPLOAD_SIZE_BYTES)) {
            message.error(
                `Image must be under ${Math.round(
                    Math.min(MAX_AVATAR_BYTES, MAX_UPLOAD_SIZE_BYTES) / 1024 / 1024
                )}MB`
            );
            return false;
        }

        mUpload.mutation.mutate(
            { resource_type: "user_avatar", file, user_id: profile.id },
            {
                onSuccess: (result) => {
                    // The Worker serves `users/*` avatars straight from R2 with no
                    // token, which is why this is a plain concatenation and not a
                    // sign-url call. Note that CG-029's signatures, which share the
                    // `users/` prefix, explicitly cannot do this.
                    // Local preview only — the row stores the FK, not this string.
                    // Built through the same helper every other reader uses, so
                    // the preview cannot disagree with what renders after the
                    // refetch (it did: this line hardcoded the Worker origin,
                    // which is the wrong host under STORAGE_DRIVER=local).
                    setAvatarUrl(Utils_Avatar_SrcFromKey(result.r2_key));

                    // The FK is the avatar. `avatar_url` is cleared rather than
                    // set alongside it: since CG-042 that column is a staging slot
                    // for a provider URL awaiting mirroring, not a place to keep a
                    // second copy of something `files` already describes. Leaving a
                    // stale URL there would outrank nothing today and mislead
                    // whoever reads the column next.
                    mProfileUpdate.mutation.mutate({
                        avatar_file_id: result.file_id,
                        avatar_url: null,
                    });
                },
            }
        );
        // `false` — the upload is driven by the mutation above, not by antd's own
        // XHR. Same posture as the template builder's PDF dropzone.
        return false;
    };

    const handleFinish = (values: InfoValues) =>
        mProfileUpdate.mutation.mutate({ full_name: values.full_name.trim() });

    return (
        <div style={{ maxWidth: 480 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginMD,
                    marginBottom: token.marginLG,
                }}
            >
                <Avatar
                    size={64}
                    src={currentAvatar ?? undefined}
                    style={{ backgroundColor: token.colorPrimaryBg, color: token.colorPrimary }}
                >
                    {Utils_String_GetInitials(profile?.full_name)}
                </Avatar>
                <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
                    <Upload beforeUpload={handleAvatar} showUploadList={false} accept="image/*">
                        <Button icon={<UploadOutlined />} loading={mUpload.mutation.isPending}>
                            Change photo
                        </Button>
                    </Upload>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Up to {Math.round(MAX_AVATAR_BYTES / 1024 / 1024)}MB. Limit is{" "}
                        {MAX_UPLOAD_SIZE_MB}MB elsewhere.
                    </Typography.Text>
                </div>
            </div>

            <Form
                form={form}
                layout="vertical"
                onFinish={handleFinish}
                requiredMark={false}
                initialValues={{ full_name: profile?.full_name ?? "" }}
            >
                <Form.Item
                    name="full_name"
                    label="Full name"
                    rules={[{ required: true, message: "Enter your full name" }]}
                >
                    <Input
                        prefix={<UserOutlined style={{ color: token.colorTextPlaceholder }} />}
                        placeholder="Jane Smith"
                        size="large"
                    />
                </Form.Item>

                <Form.Item label="Email" extra="Changing your email requires verifying it again.">
                    <Input value={profile?.email ?? ""} size="large" disabled />
                </Form.Item>

                <div
                    style={{
                        display: "flex",
                        gap: token.marginSM,
                        flexDirection: isMobile ? "column" : "row",
                    }}
                >
                    <Button
                        type="primary"
                        htmlType="submit"
                        size="large"
                        loading={mProfileUpdate.mutation.isPending}
                    >
                        Save changes
                    </Button>
                    <Button
                        size="large"
                        icon={<KeyOutlined />}
                        onClick={() => setPasswordOpen(true)}
                        disabled={!profile?.email}
                    >
                        Update password
                    </Button>
                </div>
            </Form>

            <App_ProfilePasswordModal
                open={passwordOpen}
                onClose={() => setPasswordOpen(false)}
                email={profile?.email ?? null}
            />
        </div>
    );
};
