import type { Enums } from "@/types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

const Entities_CorrectionApprovalMode: Record<
    Enums<"entities_correction_approval_mode_enum">,
    { value: Enums<"entities_correction_approval_mode_enum">; label: string; description: string }
> = {
    hr_only: { value: "hr_only", label: "HR Only", description: "Only admin/owner can approve corrections" },
    manager_only: { value: "manager_only", label: "Manager Only", description: "Only the department manager can approve" },
    both: { value: "both", label: "Both Required", description: "Both manager and HR must approve" },
};

export const const_EntitiesCorrectionApprovalModeOptions = Utils_Options_EnumsToOptions(Entities_CorrectionApprovalMode);
