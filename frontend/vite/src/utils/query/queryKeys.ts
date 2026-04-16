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
    contractTemplates: {
        all: () => ["contractTemplates"] as const,
        list: () => [...QueryKeys.contractTemplates.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.contractTemplates.all(), id] as const,
    },
    employees: {
        all: () => ["employees"] as const,
        list: () => [...QueryKeys.employees.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.employees.all(), id] as const,
    },
    employeeColumns: {
        all: () => ["employeeColumns"] as const,
        list: () => [...QueryKeys.employeeColumns.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.employeeColumns.all(), id] as const,
    },
    employeeColumnChoices: {
        all: () => ["employeeColumnChoices"] as const,
        list: () => [...QueryKeys.employeeColumnChoices.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.employeeColumnChoices.all(), id] as const,
    },
    onboardingInvitations: {
        all: () => ["onboardingInvitations"] as const,
        list: () => [...QueryKeys.onboardingInvitations.all(), "list"] as const,
        mine: () => [...QueryKeys.onboardingInvitations.all(), "mine"] as const,
        org: (organizationId: string) =>
            [...QueryKeys.onboardingInvitations.all(), "org", organizationId] as const,
        byToken: (token: string) => [...QueryKeys.onboardingInvitations.all(), "byToken", token] as const,
        preview: (token: string) => [...QueryKeys.onboardingInvitations.all(), "preview", token] as const,
        record: (id: string) => [...QueryKeys.onboardingInvitations.all(), id] as const,
    },
    contracts: {
        all: () => ["contracts"] as const,
        list: () => [...QueryKeys.contracts.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.contracts.all(), id] as const,
    },
    employeeViews: {
        all: () => ["employeeViews"] as const,
        list: () => [...QueryKeys.employeeViews.all(), "list"] as const,
        record: (id: string) => [...QueryKeys.employeeViews.all(), id] as const,
    },
};
