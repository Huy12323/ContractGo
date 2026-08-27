type OptionBase = { value: string; label: string };

export const Utils_Options_EnumsToOptions = <T extends OptionBase>(
    record: Record<string, T>
): { options: T[]; map: Record<string, T> } => ({
    options: Object.values(record),
    map: record,
});
