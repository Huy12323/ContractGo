import { App, ConfigProvider, theme as antdTheme } from "antd";

export const BG_GRADIENT =
    "linear-gradient(160deg, #e2e8f3 0%, #f0f5ff 30%, #fff1f0 70%, #e6f7ff 100%)";

const themeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        // Semantic seeds — muted/saturated family anchored on a deep-teal primary.
        // All picked with similar lightness (~25-45%) and matching saturation weight
        // so they read as one cohesive palette. ANTD auto-derives the full 10-step
        // Bg/Border/Hover/Active/Text palettes from each seed, so these five values
        // cascade across the entire app.
        colorPrimary: "#6366f1", // indigo — brand
        colorSuccess: "#2d7a4f", // forest green
        colorSuccessBg: "#ecfdf5",
        colorSuccessText: "#166534",
        colorWarning: "#c48a3c", // ochre / mustard
        colorError: "#a73939", // deep rose / burgundy
        colorErrorBg: "#fef2f2",
        colorErrorText: "#991b1b",
        colorInfo: "#818cf8", // soft indigo — secondary accent
        colorBorder: "#E5E5E5",
        colorFillAlter: "#F6F8FC",
        colorPrimaryBg: "#eef2ff",
        colorPrimaryBgHover: "#e0e7ff",
        borderRadius: 8,
        fontSize: 14,
        fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    components: {
        Button: {
            fontWeight: 600,
        },
        // Input and Select inherit ANTD defaults (subtle rounding, standard height).
        // The pill-style search input lives in App_SearchInput, scoped locally.
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
        Menu: {
            itemSelectedBg: "rgba(0, 0, 0, 0.06)",
            itemSelectedColor: "rgba(0, 0, 0, 0.88)",
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
