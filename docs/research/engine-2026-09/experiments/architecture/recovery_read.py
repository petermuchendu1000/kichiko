import time, psycopg2
c = psycopg2.connect("postgresql://postgres:localtest@127.0.0.1:54399/postgres"); k = c.cursor()
k.execute("select count(*) from b_order where status in (0,1)"); n = k.fetchone()[0]
k.execute("create index if not exists b_order_live on b_order(option_id, side, price, order_id) where status in (0,1)"); c.commit()
for trial in range(3):
    t = time.perf_counter()
    k2 = c.cursor(name="rec%d" % trial); k2.itersize = 20000
    k2.execute("select order_id,user_id,option_id,side,price,remaining from b_order where status in (0,1) order by option_id, side, price, order_id")
    book = {}
    cnt = 0
    for r in k2:
        book.setdefault((r[2], r[3]), []).append(r); cnt += 1
    k2.close(); c.commit()
    print(f"trial {trial}: loaded {cnt} live orders into {len(book)} books in {time.perf_counter()-t:.3f}s")
# fencing demo: stale epoch write must fail
k.execute("select epoch,last_seq from b_shard where shard_id=0"); e, s = k.fetchone()
k.execute("update b_shard set epoch = epoch + 1 where shard_id=0"); c.commit()
try:
    k.execute("select apply_batch(0,%s,%s,array[1],array[2],array[1]::bigint[],array[999999999999]::bigint[],array[50],array[1]::bigint[],array[1])", (e, s)); c.commit(); print("stale write ACCEPTED (bad)")
except Exception as ex:
    c.rollback(); print("stale-epoch write rejected:", str(ex).splitlines()[0])
