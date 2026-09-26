import psycopg2,time,sys,collections
c=psycopg2.connect("postgresql://supabase_admin:localtest@localhost:54339/postgres");c.autocommit=True;k=c.cursor()
cnt=collections.Counter();n=0;t_end=time.time()+float(sys.argv[1])
while time.time()<t_end:
    k.execute("select coalesce(wait_event_type,'CPU')||':'||coalesce(wait_event,'-') from pg_stat_activity where state='active' and query like '%%clob_place_order%%' and pid<>pg_backend_pid()")
    for (w,) in k.fetchall(): cnt[w]+=1
    n+=1; time.sleep(0.005)
tot=sum(cnt.values())
print("samples",n,"backend-samples",tot)
for w,v in cnt.most_common(12): print(f"  {w:40s} {100*v/tot:5.1f}%")
