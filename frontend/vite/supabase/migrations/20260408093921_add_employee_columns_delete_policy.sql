-- Add missing DELETE policy for employee_columns
-- Originally excluded in AHR-398, now needed for Field Manager

CREATE POLICY "admin_or_owner_can_delete_employee_columns"
    ON public.employee_columns FOR DELETE
    TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
    );
