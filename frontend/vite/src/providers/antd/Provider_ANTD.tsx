import { App, ConfigProvider, theme as antdTheme } from "antd";

const themeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        colorPrimary: "#0958d9",
        // Cool-neutral border + tinted alt fill — shared across the app so
        // tables, cards, dividers, and banded rows have a consistent look.
        colorBorder: "#B1B4B6",
        colorFillAlter: "#F6F8FC",
        borderRadius: 16,
        fontSize: 14,
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    components: {
        Button: {
            fontWeight: 600,
        },
        Input: {
            paddingBlock: 8,
            paddingInline: 12,
            borderRadius: 32,
        },
        Select: {
            controlHeight: 40,
            borderRadius: 32,
        },
        // Global borderRadius: 16 causes inner/outer radius clipping in
        // nested-container components. Override with coordinated values.
        Segmented: {
            borderRadius: 6,
            borderRadiusLG: 8,
            borderRadiusSM: 4,
        },
        Checkbox: {
            borderRadiusSM: 4,
        },
        Table: {
            // Spreadsheet-style tables — no rounded corners.
            headerBorderRadius: 0,
            // Plain column-header background (no tint), so the cool-tinted
            // colorFillAlter is reserved for grouping rows only.
            headerBg: "#FFFFFF",
            // Neutral-gray row hover, distinct from the cool-tinted group rows.
            rowHoverBg: "rgba(0, 0, 0, 0.04)",
        },
    },
};

export const Provider_ANTD = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider theme={themeConfig}>
        <App>{children}</App>
    </ConfigProvider>
);
