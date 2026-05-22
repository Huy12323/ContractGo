import { useState } from "react";
import { Button, DatePicker } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { RangePickerProps } from "antd/es/date-picker";
import dayjs from "dayjs";

const { RangePicker } = DatePicker;

type Props = {
    viewModeLabel: string;
    dateRange: { startDate: string; endDate: string };
    rangePresets: RangePickerProps["presets"];
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onRangeChange: RangePickerProps["onChange"];
};

export const App_TimeclockDateNav = ({ viewModeLabel, dateRange, rangePresets, onPrev, onNext, onToday, onRangeChange }: Props) => {
    const [pickerOpen, setPickerOpen] = useState(false);

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, pointerEvents: "auto" }}>
            <Button size="small" type="text" icon={<LeftOutlined />} onClick={onPrev} />
            <Button size="small" onClick={() => setPickerOpen(true)}>
                {viewModeLabel}
            </Button>
            <RangePicker
                size="small"
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                value={[dayjs(dateRange.startDate), dayjs(dateRange.endDate)]}
                onChange={(dates, dateStrings) => { onRangeChange?.(dates, dateStrings); setPickerOpen(false); }}
                presets={rangePresets}
                allowClear={false}
                separator="–"
                format="DD/MM/YYYY"
            />
            <Button size="small" onClick={onToday}>Today</Button>
            <Button size="small" type="text" icon={<RightOutlined />} onClick={onNext} />
        </div>
    );
};
