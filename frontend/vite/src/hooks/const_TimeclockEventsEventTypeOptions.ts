import type { Enums } from "@/types/database.helpers";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

const TimeclockEvents_EventType: Record<
    Enums<"timeclock_event_type_enum">,
    { value: Enums<"timeclock_event_type_enum">; label: string; color: string }
> = {
    clock_in: { value: "clock_in", label: "Clock In", color: "success" },
    clock_out: { value: "clock_out", label: "Clock Out", color: "default" },
    lunch_start: { value: "lunch_start", label: "Lunch Start", color: "warning" },
    lunch_end: { value: "lunch_end", label: "Lunch End", color: "processing" },
};

export const const_TimeclockEventsEventTypeOptions = Utils_Options_EnumsToOptions(TimeclockEvents_EventType);
