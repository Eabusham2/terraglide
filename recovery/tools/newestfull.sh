#!/bin/bash
# For a file: pool each version of its safe chain, newest first; report each one's missing count and stop at the first
# complete one (or after 12). Writes out/t/<base>.<V>.js.
rel=$1; base=$(echo $rel | sed 's#/#_#g'); spec=specs/$base.safe.chain.json
[ -f $spec ] || { echo "$rel: no spec"; exit; }
vs=$(python3 -c "import json;print(' '.join(v['name'] for v in json.load(open('$spec'))['versions'][::-1]))")
n=0
for v in $vs; do
  timeout 900 node pool.mjs $spec $v out/t/$base.$v.js >/dev/null 2>&1
  m=$(grep -c '^@@MISSING' out/t/$base.$v.js 2>/dev/null); l=$(wc -l < out/t/$base.$v.js 2>/dev/null)
  from=$(python3 -c "import json;print([x['from'][:16] for x in json.load(open('$spec'))['versions'] if x['name']=='$v'][0])")
  echo "$rel $v $from missing=$m lines=$l"
  [ "$m" = "0" ] && break
  n=$((n+1)); [ $n -ge 14 ] && break
done
