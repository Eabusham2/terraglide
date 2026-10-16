# A file rebuilt by content, in time order: start from a base text, replay every exact logged edit at its time,
# and let every numbered view after the base overwrite the stretch it shows between its anchors (lines that
# match the draft). A view's lines before its first anchor or after its last are kept aside ("edges"), and a run
# with no anchor at all is kept aside too ("unplaced"); both are written to OUT.json for placing by hand.
# usage: python3 -I stpool.py REL BASE OUT.txt OUT.json [SINCE] [UNTIL]
import json, sys, difflib, bisect, os
here = os.path.dirname(os.path.abspath(__file__))
rel, base_p, out_p, side_p = sys.argv[1:5]
SINCE = sys.argv[5] if len(sys.argv) > 5 else ''
UNTIL = sys.argv[6] if len(sys.argv) > 6 else '2026-10-12T20:03'
R = '/home/user/terraglide/'
draft = open(base_p).read().split('\n')
if draft and draft[-1] == '': draft.pop()
src = [{'t': 'base', 'why': 'base'} for _ in draft]  # where each line came from

sights = json.load(open(os.path.join(here, 'sights_st.json')))[rel]
events = [('S', s['t'], s) for s in sights if SINCE <= s['t'] < UNTIL]
for line in open(os.path.join(here, 'calls.jsonl'), encoding='utf8'):
    r = json.loads(line)
    if not (SINCE <= r['t'] < UNTIL) or r.get('error'): continue
    inp = r.get('input') or {}
    if r['name'] in ('Edit', 'MultiEdit') and inp.get('file_path') == R + rel:
        for e in inp.get('edits') or [inp]:
            events.append(('E', r['t'], {'old': e['old_string'], 'new': e['new_string'], 'all': e.get('replace_all', False), 'who': r['agent']}))
for ev in json.load(open(os.path.join(here, 'stedits.json'))) if os.path.exists(os.path.join(here, 'stedits.json')) else []:
    if ev.get('rel') == rel and SINCE <= ev['t'] < UNTIL:
        events.append(('E', ev['t'], ev))
events.sort(key=lambda e: e[1])

edges, unplaced, log = [], [], []
def runs(lines):
    out, cur = [], []
    for n, t in lines:
        if cur and n != cur[-1][0] + 1: out.append(cur); cur = []
        cur.append((n, t))
    if cur: out.append(cur)
    return out

for kind, t, ev in events:
    if kind == 'E':
        text = '\n'.join(draft) + '\n'
        if 'code' in ev:
            # a logged python edit, run on the draft as it was then: its own open()/write() see the draft
            box = {'s': text}
            class F:
                def __init__(self, mode): self.mode = mode
                def read(self): return box['s']
                def write(self, x): box['s'] = x
                def __enter__(self): return self
                def __exit__(self, *a): pass
            g = {'open': lambda p, mode='r', **k: F(mode), 'print': lambda *a, **k: None, **ev.get('vars', {})}
            try:
                exec(ev['code'], g)
            except AssertionError as e:
                log.append(f'{t[:19]} EDIT NOT FOUND ({ev.get("who","")}): code assert {e}')
                continue
            text2 = box['s']
        else:
            old, new = ev['old'], ev['new']
            c = text.count(old)
            if c == 0:
                log.append(f'{t[:19]} EDIT NOT FOUND ({ev.get("who","")}): {old[:80]!r}')
                continue
            if c > 1 and not ev.get('all'):
                log.append(f'{t[:19]} EDIT AMBIGUOUS x{c}: {old[:80]!r}')
            text2 = text.replace(old, new) if ev.get('all') else text.replace(old, new, 1)
        nd = text2.split('\n')
        if nd and nd[-1] == '': nd.pop()
        p = 0
        while p < min(len(nd), len(draft)) and nd[p] == draft[p]: p += 1
        q = 0
        while q < min(len(nd), len(draft)) - p and nd[-1 - q] == draft[-1 - q]: q += 1
        src = src[:p] + [{'t': t, 'why': 'edit'}] * (len(nd) - p - q) + src[len(draft) - q:]
        log.append(f'{t[:19]} edit at {p+1} ({len(draft)-p-q} -> {len(nd)-p-q} lines)')
        draft = nd
        assert len(src) == len(draft), (len(src), len(draft))
        continue
    s = ev
    pos = {}
    for i, l in enumerate(draft): pos.setdefault(l, []).append(i)
    for run in runs(s['lines']):
        texts = [x for _, x in run]
        if len(run) < 3: continue
        shifts = sorted(pos[x][0] - (n - 1) for n, x in run if len(x.strip()) > 6 and len(pos.get(x, [])) == 1)
        if not shifts:
            unplaced.append({'t': t, 'src': s['src'], 'from': run[0][0], 'lines': texts}); continue
        k = shifts[len(shifts) // 2]
        a = max(0, run[0][0] - 1 + k - 300); b = min(len(draft), run[-1][0] - 1 + k + 300)
        sm = difflib.SequenceMatcher(None, texts, draft[a:b], autojunk=False)
        blocks = [m for m in sm.get_matching_blocks() if m.size >= 2 or (m.size == 1 and len(texts[m.a].strip()) > 12)]
        if not blocks:
            unplaced.append({'t': t, 'src': s['src'], 'from': run[0][0], 'lines': texts}); continue
        f, l = blocks[0], blocks[-1]
        i0, i1 = f.a, l.a + l.size            # in the view
        j0, j1 = a + f.b, a + l.b + l.size    # in the draft
        if (j1 - j0) > (i1 - i0) + 200 or (i1 - i0) > (j1 - j0) + 400:
            unplaced.append({'t': t, 'src': s['src'], 'from': run[0][0], 'lines': texts, 'why': 'span mismatch'}); continue
        if draft[j0:j1] != texts[i0:i1]:
            log.append(f'{t[:19]} {s["src"][:24]}: lines {run[0][0]+i0}-{run[0][0]+i1-1} replace draft {j0+1}-{j1} ({j1-j0} -> {i1-i0})')
        draft[j0:j1] = texts[i0:i1]
        src[j0:j1] = [{'t': t, 'why': 'view'}] * (i1 - i0)
        for d in range(i1 - i0): src[j0 + d] = {'t': t, 'why': 'view'}
        if i0 > 0: edges.append({'t': t, 'src': s['src'], 'side': 'before', 'at_draft': j0 + 1, 'from': run[0][0], 'lines': texts[:i0]})
        if i1 < len(texts): edges.append({'t': t, 'src': s['src'], 'side': 'after', 'at_draft': j0 + (i1 - i0) + 1, 'from': run[0][0] + i1, 'lines': texts[i1:]})

open(out_p, 'w').write('\n'.join(draft) + '\n')
json.dump({'edges': edges, 'unplaced': unplaced, 'log': log, 'src': src}, open(side_p, 'w'))
print(f'{len(draft)} lines; {sum(1 for x in src if x["why"]=="view")} from views, {sum(1 for x in src if x["why"]=="edit")} from edits; '
      f'{len(edges)} edges ({sum(len(e["lines"]) for e in edges)} lines), {len(unplaced)} unplaced runs ({sum(len(u["lines"]) for u in unplaced)} lines)')
for l in log:
    if 'NOT FOUND' in l or 'AMBIG' in l: print(' ', l)
