# prof.py <file.cpuprofile>: where a Bedrock script profile spends its time (self and total, by function and line)
import json, collections, sys
p = json.load(open(sys.argv[1])); nodes = {n['id']: n for n in p['nodes']}; parent = {}
for n in p['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
self = collections.Counter(); total = collections.Counter(); dt = p['timeDeltas']
for s, d in zip(p['samples'], dt):
    cf = nodes[s]['callFrame']; self[(cf['functionName'], cf.get('lineNumber'))] += d
    seen = set(); x = s
    while x in nodes:
        cf = nodes[x]['callFrame']; k = (cf['functionName'], cf.get('lineNumber'))
        if k not in seen: total[k] += d; seen.add(k)
        x = parent.get(x)
        if x is None: break
T = sum(dt); span = (p['endTime'] - p['startTime']) / 1e3
idle = sum(v for k, v in self.items() if k[0] in ('(idle)', '(program)', '(garbage collector)'))
print('samples ms %.0f over %.1fs (idle %.0f ms)' % (T / 1000, span / 1000, idle / 1000))
print('SELF'); [print(f"{v/T*100:5.1f}% {k}") for k, v in self.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 16)]
print('TOTAL'); [print(f"{v/T*100:5.1f}% {k}") for k, v in total.most_common(int(sys.argv[3]) if len(sys.argv) > 3 else 26)]
