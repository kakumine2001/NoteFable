#!/usr/bin/env python3
"""Blank-screen check of the chat message area in fixture screenshots (iOS 27 blank chat investigation).

Usage: chat-blank-check.py <screenshot out-dir> [<step summary file>]

Reads <out-dir>/chat-control/captures.tsv (written by ci-chat-control.sh), the simulator logs under <out-dir>/logs
and the screenshots. The Debug app writes one NF_CHAT_GEOMETRY line before each READY line on a chat screen; its
area= is the chat list's visible rect in screen points (between the floating bars). A capture is "blank" when
(almost) no pixel in that area differs from the background. Findings are reported, they do not fail the job.
Standard library only, Python 3.9+.
"""
import collections
import html
import os
import re
import struct
import sys
import zlib

# Share of differing pixels below which the message area counts as blank. Blank captures measure 0; a chat with only
# one short question and answer is still far above it.
BLANK_INK = 0.0005
# How far a pixel's green value must be from the background to count as drawn (user bubbles and hairlines stay below).
INK_DISTANCE = 40
# Trimmed off the list's visible rect, in points: edges, scroll indicator, and the scroll-to-bottom button (40 + 8).
TRIM_LEFT, TRIM_TOP, TRIM_RIGHT, TRIM_BOTTOM = 12, 8, 12, 60
# Offset this many points beyond the end of the content is noted even when something is still drawn.
PAST_END = 40
# Normal screenshots (ci-screenshots.sh) that must show messages between the bars.
NORMAL_SCENES = ('chat', 'chat-scrolled', 'chat-streamed', 'chat-streaming')
MODE_LEGEND = (
    '`off` = current code; `a` = candidate A, new list identity per conversation (`-NFChatListIdentity YES`); '
    '`b` = candidate B, signed distance + pin past the end (`-NFChatPinPastEnd YES`); '
    '`nopin` = scroll controller never pins (`-NFChatNoPin YES`).'
)
FAILING = ('blank', 'no-list', 'no-geometry', 'missing', 'error')


def read_green(path, rows_needed):
    """Green channel of the first rows_needed(height) rows of an 8-bit RGB / RGBA non-interlaced PNG."""
    with open(path, 'rb') as handle:
        data = handle.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    position = 8
    header = None
    compressed = []
    while position + 8 <= len(data):
        length = struct.unpack('>I', data[position:position + 4])[0]
        kind = data[position + 4:position + 8]
        body = data[position + 8:position + 8 + length]
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            compressed.append(body)
        elif kind == b'IEND':
            break
        position += 12 + length
    if header is None:
        raise ValueError('no IHDR')
    width, height, depth, color, _, _, interlace = header
    if depth != 8 or color not in (2, 6) or interlace:
        raise ValueError(f'unsupported PNG (depth={depth} color={color} interlace={interlace})')
    step = 3 if color == 2 else 4
    raw = zlib.decompress(b''.join(compressed))
    stride = width * step + 1
    count = max(0, min(height, rows_needed(height)))
    rows = []
    prior = bytearray(width)
    low_bits = int.from_bytes(b'\x7f' * width, 'little')
    high_bits = int.from_bytes(b'\x80' * width, 'little')
    # PNG filters work on bytes `step` apart, so one channel can be unfiltered on its own.
    for y in range(count):
        start = y * stride
        method = raw[start]
        line = raw[start + 2:start + stride:step]
        if method == 0:
            row = bytearray(line)
        elif method == 1:
            row = bytearray(line)
            for x in range(1, width):
                row[x] = (row[x] + row[x - 1]) & 255
        elif method == 2:
            # "Up", the most common filter: add the whole row at once (byte-wise addition without carries).
            a, b = int.from_bytes(line, 'little'), int.from_bytes(prior, 'little')
            total = ((a & low_bits) + (b & low_bits)) ^ ((a ^ b) & high_bits)
            row = bytearray(total.to_bytes(width, 'little'))
        elif method == 3:
            row = bytearray(width)
            left = 0
            for x in range(width):
                left = row[x] = (line[x] + ((left + prior[x]) >> 1)) & 255
        elif method == 4:
            # Paeth. The two shortcuts give the same predictor and cover the flat background.
            row = bytearray(width)
            left = corner = 0
            for x in range(width):
                up = prior[x]
                if up == corner:
                    predicted = left
                elif left == corner:
                    predicted = up
                else:
                    to_left, to_up = up - corner, left - corner
                    to_corner = abs(to_left + to_up)
                    to_left, to_up = abs(to_left), abs(to_up)
                    if to_left <= to_up and to_left <= to_corner:
                        predicted = left
                    elif to_up <= to_corner:
                        predicted = up
                    else:
                        predicted = corner
                left = row[x] = (line[x] + predicted) & 255
                corner = up
        else:
            raise ValueError(f'unknown PNG filter {method}')
        rows.append(row)
        prior = row
    return width, height, rows


def ink_fraction(path, area, screen):
    """Share of pixels in the trimmed message area that differ from its most common value."""
    x, y, w, h = area
    screen_w, screen_h = screen
    box = {}

    def rows_needed(height):
        box['bottom'] = int((y + h - TRIM_BOTTOM) * height / screen_h)
        return box['bottom']

    width, height, rows = read_green(path, rows_needed)
    scale_x, scale_y = width / screen_w, height / screen_h
    left = max(0, int((x + TRIM_LEFT) * scale_x))
    right = min(width, int((x + w - TRIM_RIGHT) * scale_x))
    top = max(0, int((y + TRIM_TOP) * scale_y))
    region = [row[left:right] for row in rows[top:]]
    if right <= left or not region:
        raise ValueError(f'empty message area {area} on screen {screen}')
    sample = bytearray()
    for row in region[::4]:
        sample += row[::4]
    background = collections.Counter(sample).most_common(1)[0][0]
    table = bytes(1 if abs(value - background) > INK_DISTANCE else 0 for value in range(256))
    ink = sum(row.translate(table).count(1) for row in region)
    return ink / ((right - left) * len(region))


def parse_log(path):
    """idx -> {scene, geometry, graph_lines, notes} from one fixture log (one app process)."""
    segments = {}
    geometry = {}
    graph_lines = 0
    notes = []
    if not os.path.exists(path):
        return segments
    with open(path, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            if line.startswith('NF_CHAT_GEOMETRY '):
                geometry = dict(token.split('=', 1) for token in line.split()[1:] if '=' in token)
            elif line.startswith('NF_CHAT_NOTE '):
                notes.append(line.split(None, 1)[1].strip())
            elif line.startswith('NF_FIXTURE_READY '):
                fields = dict(token.split('=', 1) for token in line.split()[1:] if '=' in token)
                if 'idx' in fields:
                    segments[int(fields['idx'])] = {
                        'scene': fields.get('scene', ''),
                        'geometry': geometry if geometry.get('idx') == fields['idx'] else {},
                        'graph_lines': graph_lines,
                        'notes': notes,
                    }
                geometry = {}
                graph_lines = 0
                notes = []
            elif 'AttributeGraph' in line:
                graph_lines += 1
    return segments


def judge(out_dir, png, geometry):
    """(verdict, ink fraction or None, error text)."""
    full = os.path.join(out_dir, png)
    if not os.path.exists(full):
        return 'missing', None, ''
    if not geometry:
        return 'no-geometry', None, ''
    if geometry.get('list') != '1' or 'area' not in geometry or 'screen' not in geometry:
        return 'no-list', None, ''
    try:
        area = tuple(float(v) for v in geometry['area'].split(','))
        screen = tuple(float(v) for v in geometry['screen'].split('x'))
        ink = ink_fraction(full, area, screen)
    except Exception as error:  # one unreadable capture or odd rect must not lose the whole report
        return 'error', None, f'{type(error).__name__}: {error}'.replace('|', '/')
    return ('blank' if ink < BLANK_INK else 'ok'), ink, ''


def control_captures(out_dir):
    path = os.path.join(out_dir, 'chat-control', 'captures.tsv')
    if not os.path.exists(path):
        return []
    captures = []
    logs = {}
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            parts = line.rstrip('\n').split('\t')
            if len(parts) != 8:
                continue
            runtime, mode, round_number, scene, idx, log, png, status = parts
            if log not in logs:
                logs[log] = parse_log(os.path.join(out_dir, log))
            segment = logs[log].get(int(idx), {})
            geometry = segment.get('geometry', {})
            verdict, ink, error = judge(out_dir, png, geometry)
            captures.append({
                'runtime': runtime, 'mode': mode, 'round': int(round_number), 'scene': scene, 'png': png,
                'status': status, 'geometry': geometry, 'graph_lines': segment.get('graph_lines', 0),
                'notes': segment.get('notes', []), 'verdict': verdict, 'ink': ink, 'error': error,
            })
    return captures


def normal_captures(out_dir):
    captures = []
    logs_dir = os.path.join(out_dir, 'logs')
    if not os.path.isdir(logs_dir):
        return captures
    for name in sorted(os.listdir(logs_dir)):
        match = re.match(r'^(ios\d+)-(.+)-signed-in\.log$', name)
        if not match:
            continue
        runtime, variant = match.groups()
        if not os.path.isdir(os.path.join(out_dir, runtime, variant)):
            continue
        for _, segment in sorted(parse_log(os.path.join(logs_dir, name)).items()):
            scene = segment['scene']
            if scene not in NORMAL_SCENES:
                continue
            png = f'{runtime}/{variant}/{scene}.png'
            status = 'ok'
            if not os.path.exists(os.path.join(out_dir, png)):
                timeout_png = f'{runtime}/{variant}/{scene}-TIMEOUT.png'
                if os.path.exists(os.path.join(out_dir, timeout_png)):
                    png, status = timeout_png, 'timeout'
            verdict, ink, error = judge(out_dir, png, segment['geometry'])
            captures.append({
                'runtime': runtime, 'variant': variant, 'scene': scene, 'png': png, 'status': status,
                'geometry': segment['geometry'], 'graph_lines': segment['graph_lines'],
                'verdict': verdict, 'ink': ink, 'error': error,
            })
    return captures


def percent(ink):
    return '-' if ink is None else f'{ink * 100:.2f}%'


def cell(captures):
    """Pivot cell: how many of the runs of one scene and mode were blank / otherwise failed / rendered."""
    if not captures:
        return '-'
    total = len(captures)
    counts = collections.Counter(c['verdict'] for c in captures)
    parts = [f'**{verdict.upper()} {counts[verdict]}/{total}**' for verdict in FAILING if counts[verdict]]
    if counts['ok']:
        parts.append(f'ok {counts["ok"]}/{total}')
    timeouts = sum(1 for c in captures if c['status'] != 'ok')
    if timeouts:
        parts.append(f'({timeouts} not ready)')
    past_end = sum(1 for c in captures if scrolled_past_end(c['geometry']))
    if past_end:
        parts.append(f'(past end {past_end}/{total})')
    return ' '.join(parts)


def scrolled_past_end(geometry):
    try:
        return float(geometry.get('pastEnd', '0')) > PAST_END
    except ValueError:
        return False


def geometry_columns(geometry):
    rows = f'{geometry.get("rowsOn", "-")}/{geometry.get("rowsEver", "-")}'
    keys = ('offsetY', 'bottomY', 'pastEnd', 'contentH', 'boundsH')
    return [geometry.get(key, '-') for key in keys] + [rows, geometry.get('messages', '-'), geometry.get('following', '-')]


def table(header, rows):
    lines = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    lines += ['| ' + ' | '.join(str(v) for v in row) + ' |' for row in rows]
    return lines


def report(family, controls, normals):
    lines = [f'### Chat message area: blank-screen check ({family})', '']
    lines.append(
        f'Checked area: the chat list between the floating bars. Blank = under {BLANK_INK * 100:.2f}% of its pixels '
        f'differ from the background. {MODE_LEGEND}'
    )
    lines.append('')
    for runtime in sorted({c['runtime'] for c in controls}):
        mine = [c for c in controls if c['runtime'] == runtime]
        modes = list(dict.fromkeys(c['mode'] for c in mine))
        scenes = list(dict.fromkeys(c['scene'] for c in mine))
        lines.append(f'**Control scenes, `{runtime}`**')
        lines.append('')
        rows = [
            [f'`{scene}`'] + [cell([c for c in mine if c['scene'] == scene and c['mode'] == mode]) for mode in modes]
            for scene in scenes
        ]
        lines += table(['Scene'] + [f'`{mode}`' for mode in modes], rows)
        lines.append('')
    if not controls:
        lines += ['No control captures.', '']
    geometry_header = ['offsetY', 'bottomY', 'pastEnd', 'contentH', 'boundsH', 'rows on/ever', 'messages', 'following']
    if normals:
        lines += ['**Normal screenshots**', '']
        rows = [
            [c['runtime'], c['variant'], f'`{c["scene"]}`', c['verdict'], percent(c['ink'])] + geometry_columns(c['geometry'])
            for c in normals
        ]
        lines += table(['Runtime', 'Variant', 'Scene', 'Result', 'ink'] + geometry_header, rows)
        lines.append('')
    if controls:
        lines += ['<details><summary>Every control capture</summary>', '']
        rows = [
            [c['runtime'], c['mode'], f'`{c["scene"]}`', c['round'],
             c['verdict'] + ('' if c['status'] == 'ok' else f' ({c["status"]})') + (f' {c["error"]}' if c['error'] else ''),
             percent(c['ink'])] + geometry_columns(c['geometry']) + [c['graph_lines'], ' '.join(c['notes'])]
            for c in controls
        ]
        header = ['Runtime', 'Mode', 'Scene', 'Run', 'Result', 'ink'] + geometry_header + ['AttributeGraph lines', 'Note']
        lines += table(header, rows)
        lines += ['', '</details>', '']
    return '\n'.join(lines) + '\n'


def contact_sheet(out_dir, controls):
    """chat-control/index.html: one table per runtime, scenes by mode and run, failing captures framed red."""
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat control captures</title>',
        '<style>body{font-family:sans-serif;margin:24px}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}',
        'table{border-collapse:collapse}img{width:150px;display:block;border:3px solid transparent}',
        'img.fail{border-color:#d93025}small{display:block}</style></head><body>',
    ]
    for runtime in sorted({c['runtime'] for c in controls}):
        mine = [c for c in controls if c['runtime'] == runtime]
        columns = list(dict.fromkeys((c['mode'], c['round']) for c in mine))
        parts.append(f'<h2>{html.escape(runtime)}</h2><table><tr><th>Scene</th>')
        parts += [f'<th>{html.escape(mode)} #{number}</th>' for mode, number in columns]
        parts.append('</tr>')
        for scene in dict.fromkeys(c['scene'] for c in mine):
            parts.append(f'<tr><th>{html.escape(scene)}</th>')
            for mode, number in columns:
                found = [c for c in mine if c['scene'] == scene and c['mode'] == mode and c['round'] == number]
                if not found:
                    parts.append('<td>-</td>')
                    continue
                capture = found[0]
                source = html.escape(os.path.relpath(capture['png'], 'chat-control').replace(os.sep, '/'))
                failing = ' class="fail"' if capture['verdict'] != 'ok' or capture['status'] != 'ok' else ''
                parts.append(
                    f'<td><a href="{source}"><img{failing} src="{source}" loading="lazy" alt="{source}"></a>'
                    f'<small>{html.escape(capture["verdict"])} {percent(capture["ink"])}</small></td>'
                )
            parts.append('</tr>')
        parts.append('</table>')
    parts.append('</body></html>')
    with open(os.path.join(out_dir, 'chat-control', 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(parts))


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out_dir = argv[1]
    summary = argv[2] if len(argv) > 2 else ''
    controls = control_captures(out_dir)
    normals = normal_captures(out_dir)
    text = report(os.environ.get('NF_DEVICE_FAMILY') or 'iPhone', controls, normals)
    os.makedirs(os.path.join(out_dir, 'chat-control'), exist_ok=True)
    with open(os.path.join(out_dir, 'chat-control', 'report.md'), 'w', encoding='utf-8') as handle:
        handle.write(text)
    if controls:
        contact_sheet(out_dir, controls)
    print(text)
    if summary:
        with open(summary, 'a', encoding='utf-8') as handle:
            handle.write(text)
    blank = [c for c in controls + normals if c['verdict'] == 'blank']
    if blank:
        # One annotation: GitHub shows only a few per step.
        names = sorted({f'{c["runtime"]} {c.get("mode", c.get("variant"))} {c["scene"]}' for c in blank})
        print(f'::warning::Blank chat message area in {len(blank)} captures: {"; ".join(names)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
