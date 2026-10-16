# Read a python heredoc edit script (stdin) and print, as JSON, every s.replace(old, new) it makes:
# [{path, old, new, count}] in order. Strings are evaluated exactly (ast.literal_eval), so escapes are right.
import ast, json, sys
src = sys.stdin.read()
tree = ast.parse(src)
env = {}
out = []
def val(node):
    if isinstance(node, ast.Name): return env.get(node.id)
    try: return ast.literal_eval(node)
    except Exception: return None
for st in ast.walk(tree):
    pass
for st in tree.body:
    if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
        name = st.targets[0].id; v = st.value
        if isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute) and v.func.attr == 'replace' and isinstance(v.func.value, ast.Name) and v.func.value.id == 's':
            a = [val(x) for x in v.args]
            if len(a) >= 2 and isinstance(a[0], str) and isinstance(a[1], str):
                out.append({'path': env.get('p'), 'old': a[0], 'new': a[1], 'count': a[2] if len(a) > 2 else -1})
            else:
                out.append({'path': env.get('p'), 'unparsed': ast.unparse(v)[:200]})
            continue
        lv = val(v)
        if isinstance(lv, str): env[name] = lv
        elif isinstance(v, ast.Call): pass
    elif isinstance(st, ast.Assert): pass
    elif isinstance(st, ast.Expr) and isinstance(st.value, ast.Call):
        pass
print(json.dumps(out))
