-- Public RPC so the Worker can call db.rpc('provision_personal_workspace', { p_user_id }) via PostgREST.
CREATE OR REPLACE FUNCTION public.provision_personal_workspace(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  existing uuid;
  ws_slug text;
  ws_name text;
  user_email text;
  meta jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin')
     AND session_user NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  ws_slug := 'personal-' || substr(replace(p_user_id::text, '-', ''), 1, 12);
  SELECT w.id INTO existing FROM public.workspaces w WHERE w.slug = ws_slug;
  IF existing IS NOT NULL THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (existing, p_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN existing;
  END IF;
  SELECT u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    INTO user_email, meta
  FROM auth.users u
  WHERE u.id = p_user_id;
  ws_name := coalesce(
    nullif(btrim(meta->>'full_name'), ''),
    nullif(btrim(meta->>'name'), ''),
    nullif(split_part(coalesce(user_email, ''), '@', 1), ''),
    'Personal'
  );
  ws_name := left(ws_name, 60) || '''s workspace';
  INSERT INTO public.workspaces (name, slug, created_by)
  VALUES (ws_name, ws_slug, p_user_id)
  RETURNING id INTO existing;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (existing, p_user_id, 'owner');
  RETURN existing;
EXCEPTION
  WHEN unique_violation THEN
    SELECT w.id INTO existing FROM public.workspaces w WHERE w.slug = ws_slug;
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (existing, p_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN existing;
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_personal_workspace(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
