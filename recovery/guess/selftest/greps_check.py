# Re-run, on a rebuilt tools/selftest.mjs, every grep the logs ran on the final file (Oct 10 onward; before the
# Oct 11 05:11 edit, lines past 1311 were 4 lower) and compare with what they printed. Also the Oct 11 05:32
# `git diff | grep -n` positions against the commit. usage: python3 -I greps_check.py FILE COMMIT_FILE
import re, subprocess, sys
f, commit = sys.argv[1:3]
L = open(f).read().split('\n')
if L[-1] == '': L.pop()
bad = 0
def grep(pattern, flags=0, limit=None):
    hits = [(i + 1, l) for i, l in enumerate(L) if re.search(pattern, l, flags)]
    return hits[:limit] if limit else hits
def expect(name, got, want):
    global bad
    g = [n for n, _ in got]
    if g != want:
        bad += 1
        print(f'DIFF {name}\n   got  {g}\n   want {want}')
    else:
        print(f'ok   {name}  {want[:6]}{"..." if len(want) > 6 else ""}')
expect('Oct 11 04:54 backlog', grep(r'stops reading|not reading|bufferedAmount|MAX_BUFFERED|backlog|BACKLOG'), [7868, 7871, 7874, 7882])
expect('Oct 11 05:11 friend choices', grep(r"the account's auto-accept choices win over a fresh browser's|only the friend choices changed here are sent, and a reset"), [1318])
expect('Oct 11 05:32 two lots', grep(r'social-prefs-unsent|PREFS_UNSENT|two lots|readUnsent|markPrefUnsent|shownPrefs|bigWaiting|BIG_FRAME|SHARED_NEW_PER_MESSAGE|not landed'), [1320, 1321])
expect('Oct 11 05:48 their paths', grep(r'their paths when you want them'), [11588])
near = [(n, l) for n, l in grep(r'near|locator|compass') if 'ok(' in l][:20]
expect('Oct 11 05:50 near/locator/compass ok(', near, [68, 75, 79, 86, 97, 100, 255, 1032, 1229, 1330, 1338, 2671, 2885, 2925, 2929, 2943, 2958, 2976, 2983, 3069])
expect("Oct 11 05:50 /near 'near'", grep(r"/near|kind: 'near'|'near'"), [1388])
expect('Oct 11 05:50 locator', grep(r'locator', re.I), [])
expect("Oct 11 21:03 quoted swing", grep(r"`swing`|'swing'|\{t: *swing|\"swing\""), [])
expect('Oct 12 03:29 file writes', grep(r'writeFile|mkdtemp|writeFileSync|rmSync|unlink'), [])
# Oct 11 05:32: git diff tools/selftest.mjs | grep -n "^[-+].*\(prefs\|Unsent\|unsent\|lot\)" | head -30
diff = subprocess.run(['git', 'diff', '--no-index', commit, f], capture_output=True, text=True).stdout.split('\n')
pos = [i + 1 for i, l in enumerate(diff) if re.match(r'^[-+].*(prefs|Unsent|unsent|lot)', l)][:30]
want = [20, 37, 144, 145, 147, 148, 152, 192, 261, 262, 266, 268, 269, 270]
if pos != want:
    bad += 1
    print(f'DIFF Oct 11 05:32 git diff positions\n   got  {pos}\n   want {want}')
else:
    print('ok   Oct 11 05:32 git diff positions (14)')
print('ALL AGREE' if not bad else f'{bad} disagree')
sys.exit(1 if bad else 0)
