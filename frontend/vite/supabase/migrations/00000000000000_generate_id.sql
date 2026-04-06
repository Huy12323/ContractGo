-- Ensure pgcrypto is available for gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Custom ID generator: generate_id('prefix') → 'prefix_abc123...'
CREATE OR REPLACE FUNCTION public.generate_id(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
    bytes BYTEA;
    result TEXT := '';
    i INT;
    chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
BEGIN
    bytes := extensions.gen_random_bytes(16);
    FOR i IN 0..15 LOOP
        result := result || substr(chars, (get_byte(bytes, i) % 62) + 1, 1);
    END LOOP;
    RETURN prefix || '_' || result;
END;
$$ LANGUAGE plpgsql;
