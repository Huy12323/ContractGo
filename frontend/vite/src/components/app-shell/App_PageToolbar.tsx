import { theme } from "antd";
import { const_AppShell_PageToolbarHeight } from "@/components/app-shell/const_AppShell_Dimensions";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

/** Re-exported under its old name so existing importers keep working. The value
 *  itself now lives with the other shell dimensions rather than in a second
 *  hard-coded 48 here. */
const TOOLBAR_HEIGHT = const_AppShell_PageToolbarHeight;

// `actions` is the whole toolbar now. CG-030 removed the entity selector that
// used to sit on the left — and with it `organizationId`, which this component
// only ever held to pass down.
type Props = {
    actions?: React.ReactNode;
};

export const App_PageToolbar = ({ actions }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        // ONE ROW ON DESKTOP, TWO ON MOBILE. Consumers put a search input and one
        // or two primary buttons in `actions`. Below ~400px the row does not
        // overflow — it squashes, because the fixed `height` gives it nowhere to go
        // and every child shrinks instead. Letting it wrap and floor the height
        // rather than fix it is the whole change; no consumer has to know.
        <div
            style={{
                height: isMobile ? "auto" : TOOLBAR_HEIGHT,
                minHeight: TOOLBAR_HEIGHT,
                display: "flex",
                flexWrap: isMobile ? "wrap" : "nowrap",
                alignItems: "center",
                padding: isMobile
                    ? `${token.paddingXS}px ${token.paddingSM}px`
                    : `0 ${token.paddingMD}px`,
                borderBottom: `1px solid ${token.colorBorder}`,
                background: token.colorBgContainer,
                gap: isMobile ? token.marginXS : token.marginMD,
            }}
        >
            {actions && (
                <div
                    style={{
                        // No `marginLeft: auto`. It existed to push actions to the far
                        // side of the entity selector; with nothing on the left, it
                        // would only shove them against the right edge of an empty row.
                        width: isMobile ? "100%" : undefined,
                        display: "flex",
                        alignItems: "center",
                        flexWrap: isMobile ? "wrap" : "nowrap",
                        gap: 8,
                    }}
                >
                    {actions}
                </div>
            )}
        </div>
    );
};

export { TOOLBAR_HEIGHT };
