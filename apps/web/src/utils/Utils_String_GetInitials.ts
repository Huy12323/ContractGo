export const Utils_String_GetInitials = (name: string | null | undefined): string => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.charAt(0) ?? "";
    const last = parts[parts.length - 1]?.charAt(0) ?? "";
    if (!first) return "?";
    if (parts.length >= 2 && last) return (first + last).toUpperCase();
    return first.toUpperCase();
};
