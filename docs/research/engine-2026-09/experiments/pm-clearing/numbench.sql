\timing off
CREATE OR REPLACE FUNCTION b_numeric(n int) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE acc numeric := 0; f numeric(20,6); px numeric(4,1); u numeric; i int;
BEGIN
  FOR i IN 1..n LOOP
    f := (i % 997) + 0.5; px := ((i % 999) + 1) / 10.0;
    u := ROUND(f * px / 100.0, 8);
    acc := acc + u;
  END LOOP; RETURN acc; END $$;
CREATE OR REPLACE FUNCTION b_bigint(n int) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE acc bigint := 0; f bigint; px int; u bigint; i int;
BEGIN
  FOR i IN 1..n LOOP
    f := (i % 997) * 100 + 50; px := (i % 999) + 1;
    u := f * px;
    acc := acc + u;
  END LOOP; RETURN acc; END $$;
DO $$
DECLARE t0 timestamptz; r numeric; k int;
BEGIN
  FOR k IN 1..3 LOOP
    t0 := clock_timestamp(); PERFORM b_numeric(1000000);
    RAISE NOTICE 'plpgsql numeric 1e6 fills: % ms', round(extract(epoch from clock_timestamp()-t0)*1000);
    t0 := clock_timestamp(); PERFORM b_bigint(1000000);
    RAISE NOTICE 'plpgsql bigint  1e6 fills: % ms', round(extract(epoch from clock_timestamp()-t0)*1000);
  END LOOP;
END $$;
CREATE TABLE t_num AS SELECT ((g % 997) + 0.5)::numeric(20,6) f, (((g % 999)+1)/10.0)::numeric(4,1) px FROM generate_series(1,5000000) g;
CREATE TABLE t_int AS SELECT ((g % 997)*100+50)::bigint f, ((g % 999)+1)::int2 px FROM generate_series(1,5000000) g;
VACUUM ANALYZE t_num; VACUUM ANALYZE t_int;
SET max_parallel_workers_per_gather = 0;
\timing on
SELECT sum(round(f*px/100.0,8)) FROM t_num;
SELECT sum(round(f*px/100.0,8)) FROM t_num;
SELECT sum(f*px) FROM t_int;
SELECT sum(f*px) FROM t_int;
\timing off
SELECT pg_size_pretty(pg_relation_size('t_num')) num_size, pg_size_pretty(pg_relation_size('t_int')) int_size;
