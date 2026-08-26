import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { Provider_ANTD } from "@/providers/antd/Provider_ANTD";

/**
 * A QueryClient tuned for tests.
 *
 * Production (src/configs/query/config.ts) uses staleTime 60s and retry: 1.
 * Tests must NOT inherit that — with retry on, every error-path assertion waits
 * out a retry before the hook settles, which reads as a flaky timeout.
 */
export const makeTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
            mutations: { retry: false },
        },
    });

type WrapperOptions = {
    queryClient?: QueryClient;
};

/**
 * Mirrors src/main.tsx's provider nesting, minus realtime.
 *
 * Provider_ANTD ALREADY renders antd's <App> internally (verified) — do not add
 * another one here. Two <App> instances produce two message/notification
 * contexts and the "wrong" one wins non-deterministically.
 *
 * Provider_SupabaseRealtimeSync is deliberately omitted: it opens live Supabase
 * realtime channels, which MSW's onUnhandledRequest: "error" would reject on
 * every render. Integration tests that need it should mount it explicitly.
 */
export const TestProviders = ({
    children,
    queryClient,
}: WrapperOptions & { children: ReactNode }) => (
    <QueryClientProvider client={queryClient ?? makeTestQueryClient()}>
        <Provider_ANTD>{children}</Provider_ANTD>
    </QueryClientProvider>
);

export const renderWithProviders = (
    ui: ReactElement,
    { queryClient, ...options }: WrapperOptions & Omit<RenderOptions, "wrapper"> = {}
) =>
    render(ui, {
        wrapper: ({ children }) => (
            <TestProviders queryClient={queryClient}>{children}</TestProviders>
        ),
        ...options,
    });

export const renderHookWithProviders = <TResult, TProps>(
    callback: (props: TProps) => TResult,
    { queryClient, ...options }: WrapperOptions & { initialProps?: TProps } = {}
) =>
    renderHook(callback, {
        wrapper: ({ children }) => (
            <TestProviders queryClient={queryClient}>{children}</TestProviders>
        ),
        ...options,
    });
