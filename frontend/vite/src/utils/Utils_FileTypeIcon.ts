/**
 * Serialize Ant Design TwoTone icon trees (@ant-design/icons-svg) into data
 * URIs that Glide Data Grid's Image cells can render on canvas. Needed because
 * ANTD icon React components can't be drawn onto Glide's canvas directly —
 * this gives us the visual polish of ANTD icons in the grid.
 *
 * Colors: per-file-type, matching ANTD's design-system semantic palette
 * (red PDF, blue Word, green Excel, orange PowerPoint, etc).
 */

import FilePdfTwoTone from "@ant-design/icons-svg/es/asn/FilePdfTwoTone";
import FileWordTwoTone from "@ant-design/icons-svg/es/asn/FileWordTwoTone";
import FileExcelTwoTone from "@ant-design/icons-svg/es/asn/FileExcelTwoTone";
import FilePptTwoTone from "@ant-design/icons-svg/es/asn/FilePptTwoTone";
import FileImageTwoTone from "@ant-design/icons-svg/es/asn/FileImageTwoTone";
import FileZipTwoTone from "@ant-design/icons-svg/es/asn/FileZipTwoTone";
import FileTextTwoTone from "@ant-design/icons-svg/es/asn/FileTextTwoTone";
import FileTwoTone from "@ant-design/icons-svg/es/asn/FileTwoTone";
import VideoCameraTwoTone from "@ant-design/icons-svg/es/asn/VideoCameraTwoTone";
import SoundTwoTone from "@ant-design/icons-svg/es/asn/SoundTwoTone";
import {
    FilePdfTwoTone as FilePdfTwoToneComp,
    FileWordTwoTone as FileWordTwoToneComp,
    FileExcelTwoTone as FileExcelTwoToneComp,
    FilePptTwoTone as FilePptTwoToneComp,
    FileImageTwoTone as FileImageTwoToneComp,
    FileZipTwoTone as FileZipTwoToneComp,
    FileTextTwoTone as FileTextTwoToneComp,
    FileTwoTone as FileTwoToneComp,
    VideoCameraTwoTone as VideoCameraTwoToneComp,
    SoundTwoTone as SoundTwoToneComp,
} from "@ant-design/icons";
import type React from "react";

// ANTD icon-svg definition shape — tree of tags with attrs + children.
type SvgNode = {
    tag: string;
    attrs: Record<string, string>;
    children?: SvgNode[];
};
type TwoToneIconDef = {
    icon: (primaryColor: string, secondaryColor: string) => SvgNode;
    name: string;
    theme: string;
};

// ANTD semantic colors — primary on top, secondary tint behind.
const COLORS = {
    pdf: ["#ff4d4f", "#ffd6d6"],
    word: ["#2f54eb", "#d6e4ff"],
    excel: ["#389e0d", "#d9f7be"],
    ppt: ["#fa541c", "#ffd8bf"],
    image: ["#13c2c2", "#b5f5ec"],
    zip: ["#faad14", "#fff1b8"],
    text: ["#1890ff", "#bae7ff"],
    video: ["#722ed1", "#efdbff"],
    audio: ["#eb2f96", "#ffd6e7"],
    generic: ["#8c8c8c", "#f0f0f0"],
} as const;

function escapeAttr(v: string): string {
    return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function serializeNode(node: SvgNode): string {
    const attrs = Object.entries(node.attrs)
        .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
        .join(" ");
    const children = node.children?.map(serializeNode).join("") ?? "";
    return `<${node.tag} ${attrs}>${children}</${node.tag}>`;
}

function toDataUri(def: TwoToneIconDef, primary: string, secondary: string): string {
    const root = def.icon(primary, secondary);
    // Ensure xmlns + sizing for <img> consumers (ANTD's internal tree omits xmlns).
    const attrs = {
        ...root.attrs,
        xmlns: "http://www.w3.org/2000/svg",
        width: "24",
        height: "24",
    };
    const inner = root.children?.map(serializeNode).join("") ?? "";
    const svg = `<svg ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ")}>${inner}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Pre-computed once at module load. Each MIME gets a baked data URI.
const DATA_URIS = {
    pdf: toDataUri(FilePdfTwoTone as TwoToneIconDef, ...COLORS.pdf),
    word: toDataUri(FileWordTwoTone as TwoToneIconDef, ...COLORS.word),
    excel: toDataUri(FileExcelTwoTone as TwoToneIconDef, ...COLORS.excel),
    ppt: toDataUri(FilePptTwoTone as TwoToneIconDef, ...COLORS.ppt),
    image: toDataUri(FileImageTwoTone as TwoToneIconDef, ...COLORS.image),
    zip: toDataUri(FileZipTwoTone as TwoToneIconDef, ...COLORS.zip),
    text: toDataUri(FileTextTwoTone as TwoToneIconDef, ...COLORS.text),
    video: toDataUri(VideoCameraTwoTone as TwoToneIconDef, ...COLORS.video),
    audio: toDataUri(SoundTwoTone as TwoToneIconDef, ...COLORS.audio),
    generic: toDataUri(FileTwoTone as TwoToneIconDef, ...COLORS.generic),
} as const;

// ANTD TwoTone React component variant — for DOM rendering (attachment strip cards,
// anywhere outside the Glide canvas grid). Primary color is passed via `twoToneColor`;
// secondary is auto-derived by ANTD. Same mime→icon mapping as the data-URI variant
// above so grid cells and strip cards stay visually consistent.
type TwoToneComponent = React.FC<{
    style?: React.CSSProperties;
    className?: string;
    twoToneColor?: string;
    onClick?: React.MouseEventHandler<HTMLSpanElement>;
}>;

export type FileTypeIconComponent = {
    Icon: TwoToneComponent;
    primary: string;
};

const COMPONENTS = {
    pdf: { Icon: FilePdfTwoToneComp as TwoToneComponent, primary: COLORS.pdf[0] },
    word: { Icon: FileWordTwoToneComp as TwoToneComponent, primary: COLORS.word[0] },
    excel: { Icon: FileExcelTwoToneComp as TwoToneComponent, primary: COLORS.excel[0] },
    ppt: { Icon: FilePptTwoToneComp as TwoToneComponent, primary: COLORS.ppt[0] },
    image: { Icon: FileImageTwoToneComp as TwoToneComponent, primary: COLORS.image[0] },
    zip: { Icon: FileZipTwoToneComp as TwoToneComponent, primary: COLORS.zip[0] },
    text: { Icon: FileTextTwoToneComp as TwoToneComponent, primary: COLORS.text[0] },
    video: { Icon: VideoCameraTwoToneComp as TwoToneComponent, primary: COLORS.video[0] },
    audio: { Icon: SoundTwoToneComp as TwoToneComponent, primary: COLORS.audio[0] },
    generic: { Icon: FileTwoToneComp as TwoToneComponent, primary: COLORS.generic[0] },
} as const satisfies Record<string, FileTypeIconComponent>;

/**
 * Returns an ANTD TwoTone React component + primary color matching the given MIME.
 * For DOM consumers (attachment cards, inline previews). Canvas consumers use
 * `Utils_FileTypeIcon_DataUri` above — same mapping, different output shape.
 */
export const Utils_FileTypeIcon_Component = (mime: string): FileTypeIconComponent => {
    if (mime === "application/pdf") return COMPONENTS.pdf;
    if (
        mime === "application/msword" ||
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
        return COMPONENTS.word;
    }
    if (
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "text/csv"
    ) {
        return COMPONENTS.excel;
    }
    if (
        mime === "application/vnd.ms-powerpoint" ||
        mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
        return COMPONENTS.ppt;
    }
    if (mime.startsWith("image/")) return COMPONENTS.image;
    if (mime.startsWith("video/")) return COMPONENTS.video;
    if (mime.startsWith("audio/")) return COMPONENTS.audio;
    if (
        mime === "application/zip" ||
        mime === "application/x-zip-compressed" ||
        mime === "application/x-rar-compressed" ||
        mime === "application/x-7z-compressed" ||
        mime === "application/gzip" ||
        mime === "application/x-tar"
    ) {
        return COMPONENTS.zip;
    }
    if (mime.startsWith("text/") || mime === "application/json") return COMPONENTS.text;
    return COMPONENTS.generic;
};

/**
 * Returns a data URI for the ANTD TwoTone icon matching the given MIME type.
 * Always returns a valid URI — unknown MIMEs fall back to the generic file icon.
 */
export const Utils_FileTypeIcon_DataUri = (mime: string): string => {
    if (mime === "application/pdf") return DATA_URIS.pdf;
    if (
        mime === "application/msword" ||
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
        return DATA_URIS.word;
    }
    if (
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "text/csv"
    ) {
        return DATA_URIS.excel;
    }
    if (
        mime === "application/vnd.ms-powerpoint" ||
        mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
        return DATA_URIS.ppt;
    }
    if (mime.startsWith("image/")) return DATA_URIS.image;
    if (mime.startsWith("video/")) return DATA_URIS.video;
    if (mime.startsWith("audio/")) return DATA_URIS.audio;
    if (
        mime === "application/zip" ||
        mime === "application/x-zip-compressed" ||
        mime === "application/x-rar-compressed" ||
        mime === "application/x-7z-compressed" ||
        mime === "application/gzip" ||
        mime === "application/x-tar"
    ) {
        return DATA_URIS.zip;
    }
    if (mime.startsWith("text/") || mime === "application/json") return DATA_URIS.text;
    return DATA_URIS.generic;
};
