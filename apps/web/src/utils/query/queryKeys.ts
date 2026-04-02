export const QueryKeys = {
    organizations: {
        all: () => ["organizations"] as const,
        list: () => [...QueryKeys.organizations.all(), "list"] as const,
        mine: () => [...QueryKeys.organizations.all(), "mine"] as const,
        record: (id: string) => [...QueryKeys.organizations.all(), id] as const,
    },
    profiles: {
        all: () => ["profiles"] as const,
        list: () => [...QueryKeys.profiles.all(), "list"] as const,
        me: () => [...QueryKeys.profiles.all(), "me"] as const,
        record: (id: string) => [...QueryKeys.profiles.all(), id] as const,
    },
    orgAdminInvitations: {
        all: () => ["orgAdminInvitations"] as const,
        list: () => [...QueryKeys.orgAdminInvitations.all(), "list"] as const,
        mine: () => [...QueryKeys.orgAdminInvitations.all(), "mine"] as const,
        record: (id: string) => [...QueryKeys.orgAdminInvitations.all(), id] as const,
    },
};
