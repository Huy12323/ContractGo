import { Card, Result, Space, Typography } from "antd";
import { CreditCardOutlined } from "@ant-design/icons";

/**
 * Billing — a STRUCTURAL PLACEHOLDER, deliberately.
 *
 * There is no payment code here and none is planned by CG-050. What this reserves
 * is the route and the tab slot, so that when Stripe lands it drops into a shell
 * that already exists rather than forcing the seven-tab strip, the mobile
 * `Select` and the `activeKey` derivation to be re-cut at the same time as a
 * payments integration — which is the moment you least want to be moving
 * navigation around.
 *
 * It says "coming soon" honestly rather than showing a fake plan card. A
 * plausible-looking billing screen that does nothing is worse than an empty one:
 * someone will try to cancel through it.
 *
 * Note what billing is NOT blocked on. Signup is currently whitelist-gated
 * (CG-042), so there is no self-serve path for a customer to arrive at this page
 * on their own yet. Opening that gate is the prerequisite for monetization, not
 * this tab.
 */
export const Page_OrgSettingsBilling = () => (
    <Card>
        <Result
            icon={<CreditCardOutlined />}
            title="Billing is coming soon"
            subTitle={
                <Space direction="vertical" size="small">
                    <Typography.Text type="secondary">
                        This organization is not on a paid plan, and nothing here is charged today.
                        Plans, invoices and payment methods will appear on this page.
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        Everything your organization can do right now stays available in the
                        meantime.
                    </Typography.Text>
                </Space>
            }
        />
    </Card>
);
