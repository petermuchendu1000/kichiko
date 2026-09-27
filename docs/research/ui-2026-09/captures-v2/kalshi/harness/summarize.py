"""Roll every data/P*.json capture into data/summary.json and print a compact digest.
Only re-states measured values; derives counts, min/max, and shares."""
import json, glob, os, re, sys
D = os.path.join(os.path.dirname(__file__), '..', 'data')
out = {}
for f in sorted(glob.glob(os.path.join(D, 'P*_*.json'))):
    d = json.load(open(f)); tag = os.path.basename(f)[:-5]; m = d.get('measure') or {}
    if 'target' not in d: continue  # auxiliary probe files (e.g. ticket geometry)
    if not m:
        out[tag] = {'error': d.get('error') or d.get('measureError'), 'http': d.get('httpStatus'), 'url': d['target']['url']}; continue
    ty = m['typography']
    sizes = sorted({float(t['size'][:-2]) for t in ty})
    fams = {}
    for t in ty: fams[t['family'].split(',')[0].strip('"')] = fams.get(t['family'].split(',')[0].strip('"'), 0) + t['count']
    ia = m['interactive']; tt = m['touchTargets']['byMinSide']; n = sum(tt.values()) or 1
    out[tag] = {
        'url': d['target']['url'], 'finalUrl': d.get('finalUrl'), 'http': d.get('httpStatus'), 'capturedUtc': d.get('startedUtc'),
        'signupModalAfterMs': d.get('signupModalAppearedAfterMs'), 'action': d.get('action'), 'actionError': d.get('actionError'),
        'hydration': m['hydration'], 'docHeight': m['docHeight'], 'bodyBg': m['bodyBg'], 'rootFontSize': m['rootFontSize'],
        'fontsLoaded': m['fontsLoaded'][:12], 'familiesByTextNodes': fams, 'fontSizesPx': sizes,
        'topStyles': [{k: t[k] for k in ('family', 'size', 'weight', 'lineHeight', 'letterSpacing', 'transform', 'color', 'count')} | {'sample': t['samples'][0]['text']} for t in sorted(ty, key=lambda t: -t['count'])[:14]],
        'contrast': {k: m['contrast'][k] for k in ('textNodes', 'failAA', 'failAAWithoutBgImage')} | {'worst': m['contrast']['worstUnique'][:8]},
        'touch': tt, 'touchShareGte44': round(tt['gte44'] / n, 3), 'touchShareLt24': round(tt['lt24'] / n, 3), 'interactiveCount': m['interactiveCount'],
        'radius': m['radius'], 'paddingTop10': sorted(m['spacing']['padding'], key=lambda x: -x['n'])[:10], 'gapTop8': sorted(m['spacing']['gap'], key=lambda x: -x['n'])[:8],
        'shadows': m['shadows'][:5], 'bgPaletteTop': [(p['hex'], p['n']) for p in m['palette']['backgrounds'][:10]], 'textPaletteTop': [(p['hex'], p['n']) for p in m['palette']['text'][:10]],
        'copy': {k: m['copy'][k] for k in ('title', 'h1', 'ctaLabels', 'priceFormats', 'priceFormatCounts', 'feeAndDisclaimer')},
        'axe': d.get('axe') and {'nodesByImpact': d['axe']['nodesByImpact'], 'rules': {k: v['nodes'] for k, v in d['axe']['rules'].items()}},
        'tokenCount': m['rootTokens']['count'],
    }
json.dump(out, open(os.path.join(D, 'summary.json'), 'w'), indent=1)
for k, v in out.items():
    if 'error' in v: print(k, 'ERROR', v); continue
    print(f"{k:34s} http={v['http']} h={v['docHeight']} fam={list(v['familiesByTextNodes'])[:3]} sizes={v['fontSizesPx']} AAfail={v['contrast']['failAA']}/{v['contrast']['textNodes']} touch>=44={v['touchShareGte44']} <24={v['touchShareLt24']} axe={v['axe'] and v['axe']['nodesByImpact']}")
