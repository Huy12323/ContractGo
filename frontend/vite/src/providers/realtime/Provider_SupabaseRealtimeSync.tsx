import { useSupabaseRealtimeSync } from "@/hooks/useSupabaseRealtimeSync";

export const Provider_SupabaseRealtimeSync = ({ children }: { children: React.ReactNode }) => {
    useSupabaseRealtimeSync();
    return <>{children}</>;
};
