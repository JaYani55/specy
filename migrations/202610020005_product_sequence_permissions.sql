-- The SECURITY INVOKER product aggregate RPC inserts into the historical
-- serial-backed table under the caller's RLS identity. Authenticated users
-- need USAGE to invoke the serial sequence; table policies still control rows.
grant usage on sequence public.mentorbooking_products_id_seq to authenticated;
