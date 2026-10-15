#!/bin/bash
# usage: check1.sh rel  - count, target, conflicts and later-view check for out/chain/<rel>
f=$1; k=${f//\//_}; o=out/chain/$k
from=$(node -e "const s=require('./specs/$k.chain.json'); console.log(s.versions.at(-1).from)")
tgt=$(grep "^| $f |" status.md | cut -d'|' -f3 | xargs)
n=$(wc -l < $o)
v=$(node verify.mjs $f $o $from 2>/dev/null | tail -1)
bad=$(node verify.mjs $f $o $from 2>/dev/null | grep MISMATCH | head -2 | cut -c1-200)
echo "$f: lines $n target [$tgt] last-from $from | $v"
[ -n "$bad" ] && echo "$bad"
true
