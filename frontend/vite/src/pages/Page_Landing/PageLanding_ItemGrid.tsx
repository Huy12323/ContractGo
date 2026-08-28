// The icon-card grid shared by the Evidence and Use-cases sections.
//
// Extracted the moment there was a second caller rather than left duplicated:
// these two sections differ only in their copy and their column count, and a
// copy-pasted grid is where card padding and icon size quietly diverge.
//
// ICONS ARE LOOKED UP BY NAME because `const_LandingContent.ts` holds plain data
// and cannot hold components without becoming a `.tsx` file that imports a
// rendering library — which would defeat the point of keeping all the copy in
// one readable place. The map below is the only place the two meet, and an
// unknown name renders nothing rather than crashing the page.

import type { ComponentType } from "react";
import { Typography, theme } from "antd";
import {
    Building2,
    Clock,
    Code2,
    FileCheck2,
    Link2,
    SearchCheck,
    ShieldCheck,
    Stamp,
    User,
} from "lucide-react";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { Landing_Item } from "./const_LandingContent";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const const_Landing_Icons: Record<string, ComponentType<IconProps>> = {
    Building2,
    Clock,
    Code2,
    FileCheck2,
    Link2,
    SearchCheck,
    ShieldCheck,
    Stamp,
    User,
};

type Props = {
    items: Landing_Item[];
    /** Columns at desktop width. Tablet halves it; mobile is always one. */
    columns?: 2 | 3;
};

export const PageLanding_ItemGrid = ({ items, columns = 3 }: Props) => {
    const { token } = theme.useToken();
    const { isMobile, isDesktop } = useApp_Breakpoint();

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: isMobile
                    ? "1fr"
                    : `repeat(${isDesktop ? columns : 2}, minmax(0, 1fr))`,
                gap: token.margin,
            }}
        >
            {items.map((item) => {
                const Icon = const_Landing_Icons[item.icon];
                return (
                    <div
                        key={item.title}
                        style={{
                            background: token.colorBgContainer,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusLG,
                            padding: token.paddingLG,
                            height: "100%",
                        }}
                    >
                        {Icon && (
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: token.borderRadius,
                                    background: token.colorPrimaryBg,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginBottom: token.marginSM,
                                }}
                            >
                                <Icon size={20} color={token.colorPrimary} strokeWidth={2} />
                            </div>
                        )}
                        <Typography.Title
                            level={5}
                            style={{ marginTop: 0, marginBottom: token.marginXXS }}
                        >
                            {item.title}
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            {item.body}
                        </Typography.Paragraph>
                    </div>
                );
            })}
        </div>
    );
};
