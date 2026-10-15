-- 106: news ingestion — headlines from Kenyan/East African outlets, and the
-- association between an article and the market it bears on.
--
-- Why: polymarket.com's landing carries a feed of real journalism (Reuters,
-- Bloomberg, BBC, CNN, NYT) where each headline links to the market it moves.
-- We had no equivalent and no table shaped for one. Sources are public RSS
-- feeds (see lib/integrations/news-sources.ts); we store headline, outlet and
-- canonical URL only, and always link out to the publisher — never the body.

create table if not exists public.news_articles (
  id            uuid primary key default gen_random_uuid(),
  -- Canonical article URL. UNIQUE is the dedupe key: the same story arrives
  -- from several feeds (an outlet's own feed and Google News) and re-arrives
  -- on every poll.
  url           text        not null unique,
  title         text        not null,
  -- Display name of the outlet, e.g. 'The Standard'.
  source        text        not null,
  -- Registrable domain, for favicons and for collapsing syndicated copies.
  source_domain text        not null,
  image_url     text,
  -- 'en' or 'sw' — Taifa Leo publishes in Kiswahili.
  lang          text        not null default 'en',
  published_at  timestamptz not null,
  ingested_at   timestamptz not null default now(),
  constraint news_articles_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists news_articles_published_idx
  on public.news_articles (published_at desc);
create index if not exists news_articles_domain_published_idx
  on public.news_articles (source_domain, published_at desc);

-- Which article bears on which market, and how strongly. Scored by the
-- ingester (lib/news/match.ts); matched_terms records WHY so a bad match can
-- be diagnosed without re-running the matcher.
create table if not exists public.market_news (
  market_id     uuid        not null references public.markets(id)       on delete cascade,
  article_id    uuid        not null references public.news_articles(id) on delete cascade,
  score         real        not null,
  matched_terms text[]      not null default '{}',
  created_at    timestamptz not null default now(),
  primary key (market_id, article_id),
  constraint market_news_score_range check (score > 0 and score <= 1)
);

create index if not exists market_news_market_score_idx
  on public.market_news (market_id, score desc, created_at desc);

-- Both tables are PUBLIC-READ: these are published headlines, and the feed
-- renders for signed-out visitors. Writes are service-role only (the cron),
-- so anon/authenticated get SELECT and nothing else.
alter table public.news_articles enable row level security;
alter table public.market_news   enable row level security;

revoke all on public.news_articles from public, anon, authenticated;
revoke all on public.market_news   from public, anon, authenticated;
grant select on public.news_articles to anon, authenticated;
grant select on public.market_news   to anon, authenticated;

drop policy if exists "News articles are publicly viewable" on public.news_articles;
create policy "News articles are publicly viewable"
  on public.news_articles for select using (true);

drop policy if exists "Market news links are publicly viewable" on public.market_news;
create policy "Market news links are publicly viewable"
  on public.market_news for select using (true);

comment on table public.news_articles is
  '106: ingested headlines from public RSS feeds. Headline + outlet + canonical URL only; we never store article bodies and always link out to the publisher.';
comment on table public.market_news is
  '106: article -> market association with the score and the terms that produced it. Written by the ingest-news cron.';
