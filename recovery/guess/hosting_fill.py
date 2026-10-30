# HOSTING.md 1533 -> 1544: the three stretches filled from the Oct 7 text were 7, 3 and 1 lines short (the
# pool's gaps at 503 (46), 1010 (34) and 1491 (31); greps of the final put "The first account" at 949, the
# reset message at 976 and /password at 1113, which these lines bring mine to). Nothing logged shows what
# those lines said. WRITTEN BY ME:
#  - Fly.io: step 5 names TURN too and shows its secrets; step 6 says the first deploy builds on Fly; the
#    paragraph after says how to update (+7).
#  - The data layout lists index.json, which the Oct 9 record eviction (H4) added beside the records (+3).
#  - Publishing ends with where to ask about anything the licence does not cover (+1).
import sys
p = sys.argv[1]
s = open(p).read()
def sub(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
sub("""5. Optional secrets:

   ```sh
   fly secrets set TERRAGLIDE_JOIN_CODE=letmein TERRAGLIDE_ADMINS=YourName
   ```
""", """5. Optional secrets — a join code, admin names, and the TURN settings for
   voice (see [Voice chat](#voice-chat)):

   ```sh
   fly secrets set TERRAGLIDE_JOIN_CODE=letmein TERRAGLIDE_ADMINS=YourName
   fly secrets set TURN_URL=turn:turn.example.com:3478 TURN_USERNAME=terraglide TURN_CREDENTIAL=…
   ```
""")
sub("""   fly scale count 1     # only if status shows more than one
   ```
""", """   fly scale count 1     # only if status shows more than one
   ```

   The first deploy builds the image on Fly's own builders, which takes a
   minute or two; later ones reuse most of it.
""")
sub("""`fly certs add play.example.com` and follow what it says about DNS. Logs:
`fly logs`.
""", """`fly certs add play.example.com` and follow what it says about DNS. Logs:
`fly logs`. To update, get the new version (`git pull`, or copy the files in)
and run `fly deploy --ha=false` again: the data is on the volume, so nothing
is lost.
""")
sub("""                        shared map. Rebuilt from players/ if deleted
""", """                        shared map. Rebuilt from players/ if deleted
  index.json            a line per player: which worlds they have been on and
                        how much they explored there, read instead of their
                        files. Rebuilt from players/ if deleted
""")
sub("""`LICENSE` is the authoritative text; read section 2(e) before publishing.
""", """`LICENSE` is the authoritative text; read section 2(e) before publishing, and
ask (an issue on the repository will do) about anything it does not cover.
""")
open(p, 'w').write(s)
