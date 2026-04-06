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
    },
};

export const Provider_ANTD = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider theme={themeConfig}>
        <App>{children}</App>
    </ConfigProvider>
);
