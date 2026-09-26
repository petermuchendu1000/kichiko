#!/bin/bash
cd /tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad
export BENCH_DIR=$PWD/bench SEED_DB_URL=postgresql://supabase_admin:localtest@localhost:54339/postgres
python3 /home/user/kichiko/scripts/ops/clob/bench_engine.py fresh --users 200 --markets 4 --depth 60 >/dev/null
tag=$1; g=$2; shift 2
python3 waits.py 11 > /tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/w_$tag.txt &
python3 hp.py --tag "$tag" --gucs "$g" --seconds 12 "$@" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read()); d.pop('hot'); d.pop('gucs'); print(json.dumps(d))"
wait; cat w_$tag.txt
