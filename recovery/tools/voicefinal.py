# Final voice.js from the Oct 7 version (V14) and the Oct 9 change, which is known except its doc comment.
import sys
A=open('out/voice.v14.js').read().split('\n')
if A[-1]=='': A.pop()
F=open('out/v6/src_net_voice.js').read().split('\n')
if F[-1]=='': F.pop()
assert len(A)==1545 and len(F)==1553
B=['@@MISSING %d@@'%(i+1) for i in range(1553)]
for i in range(104): B[i]=A[i]
B[112]="const RADIO_GAIN = 0.35;"
B[113]="const RADIO_FROM_M = VOICE_FULL_M + (1 - RADIO_GAIN) * (VOICE_RANGE_M - VOICE_FULL_M);"
for j in range(106, 1545): B[j+8]=A[j]
assert A[564].strip()=='const near = known && Math.hypot(x, y, z) < VOICE_RANGE_M * 0.8;', A[564]
B[572]="      const near = known && Math.hypot(x, y, z) < RADIO_FROM_M;"
for i in range(1553):
    if F[i].startswith('@@MISSING'): continue
    if B[i].startswith('@@MISSING'): B[i]=F[i]
    elif B[i]!=F[i]: print('DISAGREE', i+1, repr(F[i])[:80], repr(B[i])[:80]); sys.exit(1)
print('missing', sum(1 for x in B if x.startswith('@@MISSING')))
open('out/voice.final.js','w').write('\n'.join(B)+'\n')
