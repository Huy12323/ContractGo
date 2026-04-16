import { App, ConfigProvider, theme as antdTheme } from "antd";

const themeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        // Semantic seeds — muted/saturated family anchored on a deep-teal primary.
        // All picked with similar lightness (~25-45%) and matching saturation weight
        // so they read as one cohesive palette. ANTD auto-derives the full 10-step
        // Bg/Border/Hover/Active/Text palettes from each seed, so these five values
        // cascade across the entire app.
        colorPrimary: "#136a7b", // deep teal / petrol — brand
        colorSuccess: "#2d7a4f", // forest green
        colorWarning: "#c48a3c", // ochre / mustard
        colorError: "#a73939",   // deep rose / burgundy
        colorInfo: "#3a6ea5",    // steel blue (distinct from teal primary)
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
