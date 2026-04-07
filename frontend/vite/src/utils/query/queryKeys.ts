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
    adminInvitations: {
        all: () => ["adminInvitations"] as const,
        list: () => [...QueryKeys.adminInvitations.all(), "list"] as const,
        mine: () => [...QueryKeys.adminInvitations.all(), "mine"] as const,
        record: (id: string) => [...QueryKeys.adminInvitations.all(), id] as const,
    },
    entities: {
        all: () => ["entities"] as const,
        list: () => [...QueryKeys.entities.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.entities.all(), id] as const,
    },
    departments: {
        all: () => ["departments"] as const,
        list: () => [...QueryKeys.departments.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.departments.all(), id] as const,
    },
};
