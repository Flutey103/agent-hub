-- Agent avatars. Additive: nullable columns on agents, plus select grants so the
-- browser can read them. The image bytes are not stored here. The Worker caches
-- them in OAUTH_KV and serves /api/agents/:id/avatar. avatar_url is that path,
-- or a data URL when KV is unavailable. Members cannot update these columns;
-- writes go through the Worker so a user cannot point the board at an arbitrary host.

alter table public.agents
  add column avatar_url text,
  add column client_uri text,
  add column logo_uri text,
  add column website_url text;

alter table public.agents
  add constraint agents_avatar_url_len check (avatar_url is null or char_length(avatar_url) <= 120000),
  add constraint agents_client_uri_https check (client_uri is null or (char_length(client_uri) <= 2000 and client_uri like 'https://%')),
  add constraint agents_logo_uri_https check (logo_uri is null or (char_length(logo_uri) <= 2000 and logo_uri like 'https://%')),
  add constraint agents_website_url_https check (website_url is null or (char_length(website_url) <= 500 and website_url like 'https://%'));

comment on column public.agents.avatar_url is 'Same-origin /api/agents/:id/avatar path, or a data URL capped near 64KB. The browser does not request the third-party host.';
comment on column public.agents.client_uri is 'client_uri from the OAuth client metadata document or dynamic registration.';
comment on column public.agents.logo_uri is 'logo_uri from OAuth client metadata, or an icon URL a member set for an API-key agent.';
comment on column public.agents.website_url is 'Public https origin used to resolve a favicon. From OAuth metadata, or set in Agents settings.';

grant select (avatar_url, client_uri, logo_uri, website_url) on table public.agents to authenticated;
