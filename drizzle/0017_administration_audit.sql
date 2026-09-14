CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at","id");--> statement-breakpoint
CREATE FUNCTION public.record_administration_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actor text := nullif(current_setting('hlidac.audit_actor', true), '');
  old_data jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  new_data jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  target text := coalesce(new_data->>'id', old_data->>'id');
  action_name text;
  metadata jsonb := '{}'::jsonb;
  changed_fields jsonb;
BEGIN
  IF TG_TABLE_NAME = 'user' THEN
    IF TG_OP = 'DELETE' THEN
      action_name := 'user.deleted';
    ELSIF (old_data->'role') IS DISTINCT FROM (new_data->'role') AND
      (TG_OP <> 'INSERT' OR coalesce(new_data->>'role', 'user') <> 'user') THEN
      action_name := 'user.role_changed';
      metadata := jsonb_build_object('before', old_data->>'role', 'after', new_data->>'role');
    END IF;
    IF action_name IS NOT NULL THEN
      INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(actor,target,action_name,metadata);
    END IF;
    IF TG_OP = 'UPDATE' AND (old_data->'banned' IS DISTINCT FROM new_data->'banned' OR old_data->'ban_expires' IS DISTINCT FROM new_data->'ban_expires' OR old_data->'ban_reason' IS DISTINCT FROM new_data->'ban_reason') THEN
      INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(actor,target,'user.ban_changed',jsonb_build_object('before',old_data->'banned','after',new_data->'banned','expiresAt',new_data->'ban_expires','reasonChanged',old_data->'ban_reason' IS DISTINCT FROM new_data->'ban_reason'));
    END IF;
  ELSIF TG_TABLE_NAME = 'sso_provider' THEN
    SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO changed_fields
      FROM unnest(ARRAY['provider_id','issuer','domain','name','oidc_config','saml_config']) key
      WHERE old_data->key IS DISTINCT FROM new_data->key;
    IF changed_fields <> '[]'::jsonb THEN
      INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(actor,target,'sso.' || lower(TG_OP),jsonb_build_object('changedFields',changed_fields));
    END IF;
  ELSIF TG_TABLE_NAME = 'session' THEN
    IF TG_OP = 'INSERT' AND new_data->>'impersonated_by' IS NOT NULL THEN
      INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(coalesce(actor,new_data->>'impersonated_by'),new_data->>'user_id','impersonation.started',jsonb_build_object('expiresAt',new_data->'expires_at'));
    ELSIF TG_OP = 'DELETE' AND old_data->>'impersonated_by' IS NOT NULL THEN
      INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(coalesce(actor,old_data->>'impersonated_by'),old_data->>'user_id','impersonation.session_removed','{}'::jsonb);
    END IF;
  ELSIF TG_TABLE_NAME = 'account' AND new_data->>'provider_id' = 'credential' AND new_data->>'password' IS NOT NULL AND old_data->'password' IS DISTINCT FROM new_data->'password' THEN
    INSERT INTO public.admin_audit(actor_id,target_id,action,details) VALUES(actor,new_data->>'user_id','password.changed','{}'::jsonb);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_administration_audit AFTER INSERT OR UPDATE OR DELETE ON public."user" FOR EACH ROW EXECUTE FUNCTION public.record_administration_change();
--> statement-breakpoint
CREATE TRIGGER sso_administration_audit AFTER INSERT OR UPDATE OR DELETE ON public.sso_provider FOR EACH ROW EXECUTE FUNCTION public.record_administration_change();
--> statement-breakpoint
CREATE TRIGGER impersonation_administration_audit AFTER INSERT OR DELETE ON public.session FOR EACH ROW EXECUTE FUNCTION public.record_administration_change();
--> statement-breakpoint
CREATE TRIGGER password_administration_audit AFTER INSERT OR UPDATE ON public.account FOR EACH ROW EXECUTE FUNCTION public.record_administration_change();
