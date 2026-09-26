#!/bin/bash
# usage: runv.sh tag gucs [extra hp args]
cd /tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad
export BENCH_DIR=$PWD/bench SEED_DB_URL=postgresql://supabase_admin:localtest@localhost:54339/postgres
python3 /home/user/kichiko/scripts/ops/clob/bench_engine.py fresh --users 200 --markets 4 --depth 60 >/dev/null
tag=$1; g=$2; shift 2
python3 hp.py --tag "$tag" --gucs "$g" "$@" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
h=d.pop('hot'); print(json.dumps(d)); print('   HOT', {k:(v['upd'],v['hot']) for k,v in h.items() if v['upd']})"
