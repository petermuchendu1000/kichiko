\pset format unaligned
\pset tuples_only on
select 'kind|ns_per_op_run1|run2|run3';
select k || '|' || (select string_agg(x::text,'|') from (select mb.bench(k, case when k in ('assign','numeric_expr','call_sql_fn','call_pl_fn') then 1000000 else 10000 end) x from generate_series(1,3)) s)
from unnest(array['assign','numeric_expr','call_sql_fn','call_pl_fn','select_pk','dynamic_execute','select_pk_forupdate','select_pk_forkeyshare','advisory_xact','update_hot_1idx','update_hot_8idx','update_nonhot_8idx','insert_0fk','insert_0fk_returning','insert_4fk','insert_generated','insert_after_row_trg','insert_before_row_trg','insert_setbased','insert_setbased_4fk']) k;
