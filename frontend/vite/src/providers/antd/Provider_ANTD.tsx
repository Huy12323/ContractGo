import { App, ConfigProvider, theme as antdTheme } from "antd";

const themeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        colorPrimary: "#0958d9",
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
    },
};

export const Provider_ANTD = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider theme={themeConfig}>
        <App>{children}</App>
    </ConfigProvider>
);
