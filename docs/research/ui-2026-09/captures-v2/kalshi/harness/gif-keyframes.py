"""Keep the 60 MB budget: reduce each Help-Center GIF (official Kalshi UI screen recordings
embedded in help.kalshi.com articles) to its visually distinct key frames.
Key frame = >=0.15% of pixels changed by >24 levels vs the last kept frame (catches small
ticket edits such as typed amounts). Cap 6 per GIF (first, last, then largest changes).
Frames wider than 2000 px are halved exactly (they are dpr-2 recordings) and the factor is
recorded. JPEG q78. Source URL, bytes, sha256, frame count kept in data/help-gif-keyframes.json.
GIFs are downloaded to a scratch dir and deleted after processing."""
import glob, hashlib, json, os, subprocess, time, sys
from PIL import Image, ImageChops
SH = '../shots'; TMP = sys.argv[1]; out = {}
src = json.load(open('../data/raw/help/images-and-links.json'))
gifs = [(i['file'], i['src']) for a in src.values() for i in a['images'] if i['file'].endswith('.gif')]
for fn, url in gifs:
    p = f'{TMP}/{fn}'
    if not os.path.exists(p):
        subprocess.run(['curl', '-sS', '-L', '--max-time', '90', '-o', p, url]); time.sleep(3)
    raw = open(p, 'rb').read(); im = Image.open(p); n = im.n_frames
    frames = []; prev = None; t = 0
    for f in range(n):
        im.seek(f); fr = im.convert('RGB'); d = im.info.get('duration', 0)
        if prev is None: score = 1.0
        else:
            diff = ImageChops.difference(fr, prev).convert('L').point(lambda v: 255 if v > 24 else 0)
            score = diff.histogram()[255] / (fr.size[0] * fr.size[1])
        if score > 0.0015: frames.append([f, t, fr, score]); prev = fr
        t += d
    last = frames[-1]
    if len(frames) > 6:
        mid = sorted(frames[1:-1], key=lambda x: -x[3])[:4]
        frames = [frames[0]] + sorted(mid, key=lambda x: x[0]) + [last]
    scale = 0.5 if im.size[0] > 2000 else 1.0
    files = []
    for f, tt, fr, sc in frames:
        if scale != 1.0: fr = fr.resize((fr.size[0] // 2, fr.size[1] // 2), Image.LANCZOS)
        o = fn.replace('.gif', f'_f{f:03d}_t{tt/1000:.1f}s.jpg'); fr.save(f'{SH}/{o}', quality=78); files.append(o)
    out[fn] = {'source_url': url, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
               'native_px': im.size, 'saved_scale': scale, 'frames': n, 'distinct_frames_found': len(frames), 'keyframes_kept': files}
    print(fn, n, '->', len(files), 'scale', scale, flush=True)
json.dump(out, open('../data/help-gif-keyframes.json', 'w'), indent=1)
