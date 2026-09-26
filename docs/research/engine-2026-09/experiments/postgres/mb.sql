\set QUIET on
drop schema if exists mb cascade; create schema mb;
create table mb.parent(id bigint primary key, pad text);
insert into mb.parent select g, 'p' from generate_series(1,20000) g;
create table mb.t1(id bigint primary key, n bigint, v numeric, pad text) with (fillfactor=70);
insert into mb.t1 select g,0,0,'x' from generate_series(1,20000) g;
create table mb.t8(id bigint primary key, n bigint, v numeric, a bigint, b bigint, c bigint, d bigint, e bigint, f bigint, g bigint) with (fillfactor=70);
insert into mb.t8 select g,0,0,g,g,g,g,g,g,g from generate_series(1,20000) g;
create index on mb.t8(n); create index on mb.t8(a); create index on mb.t8(b); create index on mb.t8(c); create index on mb.t8(d); create index on mb.t8(e); create index on mb.t8(f);
create table mb.ins0(id bigserial primary key, p1 bigint, p2 bigint, p3 bigint, p4 bigint, amt numeric);
create table mb.ins4(id bigserial primary key, p1 bigint references mb.parent, p2 bigint references mb.parent, p3 bigint references mb.parent, p4 bigint references mb.parent, amt numeric);
create table mb.ins0g(id bigserial primary key, p1 bigint, p2 bigint, p3 bigint, p4 bigint, amt numeric, g numeric generated always as (amt*2) stored);
create table mb.ins0t(id bigserial primary key, p1 bigint, p2 bigint, p3 bigint, p4 bigint, amt numeric);
create function mb.noop_trg() returns trigger language plpgsql as $$begin return new; end$$;
create trigger t after insert on mb.ins0t for each row execute function mb.noop_trg();
create table mb.ins0b(id bigserial primary key, p1 bigint, p2 bigint, p3 bigint, p4 bigint, amt numeric);
create trigger t before insert on mb.ins0b for each row execute function mb.noop_trg();
create function mb.sqladd(a int, b int) returns int language sql immutable as $$ select a + b $$;
create function mb.pladd(a int, b int) returns int language plpgsql immutable as $$ begin return a + b; end $$;
create or replace function mb.bench(kind text, cnt int) returns numeric language plpgsql as $f$
declare t0 timestamptz; x bigint := 0; v bigint; i int; r numeric;
begin
  t0 := clock_timestamp();
  if kind = 'assign' then for i in 1..cnt loop x := x + 1; end loop;
  elsif kind = 'numeric_expr' then for i in 1..cnt loop r := round((i * 57.3) / 100.0, 6); end loop;
  elsif kind = 'select_pk' then for i in 1..cnt loop select t.n into v from mb.t1 t where id = 1 + i % 20000; end loop;
  elsif kind = 'select_pk_forupdate' then for i in 1..cnt loop select t.n into v from mb.t1 t where id = 1 + i % 20000 for update; end loop;
  elsif kind = 'select_pk_forkeyshare' then for i in 1..cnt loop perform 1 from mb.parent where id = 1 + i % 20000 for key share; end loop;
  elsif kind = 'advisory_xact' then for i in 1..cnt loop perform pg_advisory_xact_lock(i); end loop;
  elsif kind = 'update_hot_1idx' then for i in 1..cnt loop update mb.t1 set n = n + 1 where id = 1 + i % 20000; end loop;
  elsif kind = 'update_hot_8idx' then for i in 1..cnt loop update mb.t8 set v = t8.v + 1 where id = 1 + i % 20000; end loop;
  elsif kind = 'update_nonhot_8idx' then for i in 1..cnt loop update mb.t8 set n = n + 1 where id = 1 + i % 20000; end loop;
  elsif kind = 'insert_0fk' then for i in 1..cnt loop insert into mb.ins0(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i); end loop;
  elsif kind = 'insert_0fk_returning' then for i in 1..cnt loop insert into mb.ins0(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i) returning id into v; end loop;
  elsif kind = 'insert_4fk' then for i in 1..cnt loop insert into mb.ins4(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i); end loop;
  elsif kind = 'insert_generated' then for i in 1..cnt loop insert into mb.ins0g(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i); end loop;
  elsif kind = 'insert_after_row_trg' then for i in 1..cnt loop insert into mb.ins0t(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i); end loop;
  elsif kind = 'insert_before_row_trg' then for i in 1..cnt loop insert into mb.ins0b(p1,p2,p3,p4,amt) values (1+i%20000,2,3,4,i); end loop;
  elsif kind = 'insert_setbased' then insert into mb.ins0(p1,p2,p3,p4,amt) select 1+g%20000,2,3,4,g from generate_series(1,cnt) g;
  elsif kind = 'insert_setbased_4fk' then insert into mb.ins4(p1,p2,p3,p4,amt) select 1+g%20000,2,3,4,g from generate_series(1,cnt) g;
  elsif kind = 'call_sql_fn' then for i in 1..cnt loop x := mb.sqladd(i, 1); end loop;
  elsif kind = 'call_pl_fn' then for i in 1..cnt loop x := mb.pladd(i, 1); end loop;
  elsif kind = 'dynamic_execute' then for i in 1..cnt loop execute 'select n from mb.t1 where id = $1' into v using 1 + i % 20000; end loop;
  end if;
  return round(extract(epoch from clock_timestamp() - t0) * 1e9 / cnt);   -- ns per iteration
end $f$;
