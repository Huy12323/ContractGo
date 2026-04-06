-- ============================================
-- Drop currencies reference table
-- Replaced by local TypeScript constants (AHR-320)
-- ============================================

DROP POLICY IF EXISTS "authenticated_can_view_currencies" ON public.currencies;
DROP TABLE IF EXISTS public.currencies;
