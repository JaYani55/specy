-- Keep page publication timestamps consistent across MCP, dashboard, and API writes.
-- Semantics: published_at is the latest publication transition timestamp. It is
-- set when a page enters published state and cleared when it leaves published.

create or replace function public.sync_page_publication_timestamp()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  elsif new.status is distinct from 'published' and (tg_op = 'INSERT' or old.status = 'published') then
    new.published_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_page_publication_timestamp on public.pages;
create trigger sync_page_publication_timestamp
before insert or update of status on public.pages
for each row
execute function public.sync_page_publication_timestamp();

update public.pages
set published_at = coalesce(published_at, updated_at, now())
where status = 'published'
  and published_at is null;

update public.pages
set published_at = null
where status <> 'published'
  and published_at is not null;
