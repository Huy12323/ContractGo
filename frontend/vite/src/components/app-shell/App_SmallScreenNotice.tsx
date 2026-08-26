// "This one needs a bigger screen."
//
// For the two surfaces that are genuinely multi-rail: the template field
// workspace (thumbnails · roles + palette · canvas · properties — its own comment
// puts the chrome at ~785px before the canvas gets a pixel) and the envelope
// composer. Both place things on a PDF by dragging, and both need the rails and
// the canvas visible at the same time to do it.
//
// WHY A NOTICE RATHER THAN A RESPONSIVE REWRITE. A field placed a few percent off
// is not a layout bug, it is a wrong document — `x_pct`/`y_pct` are what the
// server burns the value into. Making that gesture work on a fingertip is a real
// piece of design work with a real failure mode, and shipping a half version of
// it would let someone author a broken template on a train. Saying so is honest;
// silently rendering a broken editor is not.
//
// WHY IT IS NOT A WALL. `onViewAnyway` is always offered. Someone who only wants
// to READ what a template contains, or who is on a tablet a breakpoint got wrong,
// should not be locked out of their own data — they get the desktop layout in a
// horizontally scrollable box, which is awkward but complete.

import { Button, Result, theme } from "antd";
import { DesktopOutlined } from "@ant-design/icons";

type Props = {
    /** What the signer/sender was trying to open, e.g. "the template editor". */
    title: string;
    description: string;
    onViewAnyway: () => void;
};

export const App_SmallScreenNotice = ({ title, description, onViewAnyway }: Props) => {
    const { token } = theme.useToken();

    return (
        <div
            style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: token.paddingMD,
                overflow: "auto",
            }}
        >
            <Result
                icon={<DesktopOutlined style={{ color: token.colorPrimary }} />}
                title={title}
                subTitle={description}
                extra={<Button onClick={onViewAnyway}>View anyway on this screen</Button>}
            />
        </div>
    );
};
