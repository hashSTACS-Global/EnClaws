#!/usr/bin/env python3
"""
feishu-meeting-minutes: Download meeting recording and transcribe via faster-whisper.

Usage:
    python minutes.py --open-id "ou_xxx" --meeting-no "123456789"
    python minutes.py --open-id "ou_xxx" --file "/path/to/recording.mp4"

Output: single-line JSON to stdout.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
AUTH_DIR = os.path.join(SCRIPT_DIR, '..', 'feishu-auth')
BASE_URL = 'https://open.feishu.cn/open-apis'
MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024  # 1GB


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config():
    """Load appId/appSecret, same cascade as feishu-auth/token-utils.js."""
    # 1. Environment variables
    app_id = os.environ.get('FEISHU_APP_ID')
    app_secret = os.environ.get('FEISHU_APP_SECRET')
    if app_id and app_secret:
        return {'appId': app_id, 'appSecret': app_secret}

    # 2. feishu-auth/config.json
    config_path = os.path.join(AUTH_DIR, 'config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if cfg.get('appId') and cfg.get('appSecret'):
            return cfg

    # 3. ~/.openclaw/openclaw.json -> channels.feishu
    openclaw_candidates = [
        os.path.join(os.path.expanduser('~'), '.openclaw', 'openclaw.json'),
        os.path.join(SCRIPT_DIR, '..', '..', '..', 'openclaw.json'),
        os.path.join(SCRIPT_DIR, '..', '..', 'openclaw.json'),
    ]
    for p in openclaw_candidates:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                feishu_cfg = raw.get('channels', {}).get('feishu', {})
                # Direct appId/appSecret
                if feishu_cfg.get('appId') and feishu_cfg.get('appSecret'):
                    return {'appId': feishu_cfg['appId'], 'appSecret': feishu_cfg['appSecret']}
                # accounts.*
                accounts = feishu_cfg.get('accounts', {})
                for acc in accounts.values():
                    if acc and acc.get('appId') and acc.get('appSecret') and acc.get('enabled', True):
                        return {'appId': acc['appId'], 'appSecret': acc['appSecret']}
            except (json.JSONDecodeError, OSError):
                continue

    die('config_error',
        'appId/appSecret not found. Checked: env FEISHU_APP_ID/FEISHU_APP_SECRET, '
        f'{os.path.join(AUTH_DIR, "config.json")}, ~/.openclaw/openclaw.json')


def get_tenant_token(cfg):
    """Get tenant_access_token."""
    url = f'{BASE_URL}/auth/v3/tenant_access_token/internal'
    body = json.dumps({'app_id': cfg['appId'], 'app_secret': cfg['appSecret']}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    if data.get('code') != 0:
        die('auth_error', f"获取 tenant_access_token 失败: {data.get('msg')}")
    return data['tenant_access_token']


# ---------------------------------------------------------------------------
# Feishu VC API
# ---------------------------------------------------------------------------

def api_get(path, token, params=None):
    """GET request to Feishu API."""
    url = f'{BASE_URL}{path}'
    if params:
        qs = '&'.join(f'{k}={v}' for k, v in params.items() if v is not None)
        if qs:
            url += '?' + qs
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8', errors='replace')
        except Exception:
            pass
        log(f"API error: HTTP {e.code} {path}\n{body}")
        if e.code == 403:
            die('permission_required', f'权限不足 (403): {path}',
                required_scopes=['minutes:minutes.media:export'])
        if e.code == 401:
            die('auth_required', 'token 已失效，请重新授权',
                required_scopes=['minutes:minutes.media:export'])
        die('api_error', f'HTTP {e.code}: {body[:500]}')


def find_meeting_id(meeting_no, token):
    """meeting_no (9-digit) -> meeting_id via list_by_no."""
    now = int(time.time())
    # Search last 30 days
    start_time = str(now - 30 * 24 * 3600)
    end_time = str(now)
    data = api_get('/vc/v1/meetings/list_by_no', token, {
        'meeting_no': meeting_no,
        'start_time': start_time,
        'end_time': end_time,
    })
    if data.get('code') != 0:
        die('api_error', f"查询会议失败: code={data.get('code')} msg={data.get('msg')}")

    briefs = data.get('data', {}).get('meeting_briefs', [])
    if not briefs:
        die('not_found', f"未找到会议号 {meeting_no} 对应的会议")

    # Return the most recent meeting
    meeting = briefs[-1]
    return meeting.get('id'), meeting.get('topic', '未命名会议')


def get_recording_info(meeting_id, token):
    """Get recording minutes URL and duration."""
    data = api_get(f'/vc/v1/meetings/{meeting_id}/recording', token)
    if data.get('code') != 0:
        code = data.get('code')
        msg = data.get('msg', '')
        if code == 121001 or 'no recording' in msg.lower():
            die('no_recording', '该会议没有录制文件')
        die('api_error', f"获取录制信息失败: code={code} msg={msg}")

    recording = data.get('data', {}).get('recording', data.get('data', {}))
    minutes_url = recording.get('url') or data.get('data', {}).get('url')
    duration = recording.get('duration') or data.get('data', {}).get('duration', 0)

    if not minutes_url:
        die('no_recording', '录制文件 URL 为空，可能录制尚未完成')

    return minutes_url, int(duration)


def extract_minute_token(minutes_url):
    """Extract minute_token (24 chars) from minutes URL."""
    m = re.search(r'/minutes/([a-z0-9]{24})', minutes_url)
    if not m:
        die('parse_error', f'无法从妙记 URL 提取 minute_token: {minutes_url}')
    return m.group(1)


def get_media_download_url(minute_token, token):
    """Get actual media download URL from Minutes API."""
    data = api_get(f'/minutes/v1/minutes/{minute_token}/media', token)
    if data.get('code') != 0:
        code = data.get('code')
        msg = data.get('msg', '')
        # 99991679 = scope insufficient, need user re-auth
        if code == 99991679 or 'permission' in msg.lower() or 'unauthorized' in msg.lower():
            die('permission_required', msg,
                required_scopes=['minutes:minutes.media:export'])
        die('api_error', f"获取妙记媒体文件失败: code={code} msg={msg}")
    url = data.get('data', {}).get('download_url')
    if not url:
        die('no_recording', '妙记媒体文件下载链接为空')
    log(f"获取到媒体下载链接")
    return url


# ---------------------------------------------------------------------------
# Download & Transcribe
# ---------------------------------------------------------------------------

def download_recording(url, dest_path):
    """Download recording file from pre-signed media URL."""
    log(f"正在下载录制文件到 {dest_path} ...")

    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            content_length = resp.headers.get('Content-Length')
            if content_length and int(content_length) > MAX_FILE_SIZE:
                die('file_too_large', f"录制文件 {int(content_length) // 1024 // 1024}MB 超过 1GB 限制")

            downloaded = 0
            with open(dest_path, 'wb') as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if downloaded > MAX_FILE_SIZE:
                        die('file_too_large', f"录制文件超过 1GB 限制")
    except urllib.error.HTTPError as e:
        die('download_error', f"下载录制文件失败: HTTP {e.code} {e.reason}")

    file_size = os.path.getsize(dest_path)
    if file_size == 0:
        die('download_error', '下载录制文件失败：文件大小为 0')
    log(f"下载完成，文件大小: {file_size // 1024 // 1024}MB ({file_size} bytes)")
    return file_size


def transcribe(file_path):
    """Transcribe audio/video file using faster-whisper. Returns (timestamped, plain)."""
    log("正在转写语音...")
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die('dependency_error', 'faster-whisper 未安装，请执行: pip install faster-whisper')

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(file_path, vad_filter=True, language="zh")

    timestamped_lines = []
    plain_lines = []
    for segment in segments:
        timestamped_lines.append(f"[{segment.start:.1f}s-{segment.end:.1f}s] {segment.text}")
        plain_lines.append(segment.text)

    log(f"转写完成，共 {len(timestamped_lines)} 段")
    return '\n'.join(timestamped_lines), '\n'.join(plain_lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    """Log to stderr (stdout reserved for JSON output)."""
    print(msg, file=sys.stderr)


def out(obj):
    """Output JSON to stdout."""
    print(json.dumps(obj, ensure_ascii=False))


def die(error, message, required_scopes=None):
    """Output error JSON and exit."""
    result = {'error': error, 'message': message}
    if required_scopes:
        result['required_scopes'] = required_scopes
    out(result)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def get_user_token(open_id, cfg):
    """Get user_access_token by calling Node's getValidToken (tokens are encrypted)."""
    script = (
        f"const tu = require('{AUTH_DIR.replace(os.sep, '/')}/token-utils.js');"
        f"tu.getValidToken('{open_id}', '{cfg['appId']}', '{cfg['appSecret']}')"
        f".then(t => process.stdout.write(t || ''));"
    )
    result = subprocess.run(
        ['node', '-e', script],
        capture_output=True, text=True, timeout=15,
    )
    access_token = result.stdout.strip()
    if not access_token:
        die('auth_required', f'用户未授权或 token 已过期。open_id: {open_id}',
            required_scopes=['minutes:minutes.media:export'])
    return access_token


def main():
    parser = argparse.ArgumentParser(description='飞书会议录制转写')
    parser.add_argument('--meeting-no', help='9位会议号（自动查会议录制）')
    parser.add_argument('--open-id', required=True, help='用户 open_id')
    parser.add_argument('--file', help='本地音视频文件路径（跳过下载）')
    parser.add_argument('--keep-files', action='store_true', help='保留临时文件（调试用）')
    args = parser.parse_args()

    if not args.file and not args.meeting_no:
        die('missing_param', '需要提供 --meeting-no 或 --file 之一')

    topic = '未命名会议'
    meeting_id = None
    duration_seconds = 0
    tmp_dir = None

    try:
        if args.file:
            # Mode 1: Local file
            video_path = args.file
            if not os.path.exists(video_path):
                die('file_not_found', f'文件不存在: {video_path}')
            log(f"使用本地文件: {video_path}")

        else:
            # Mode 2: Auto-find via meeting_no
            cfg = load_config()
            token = get_tenant_token(cfg)

            log(f"正在查询会议号 {args.meeting_no} ...")
            meeting_id, topic = find_meeting_id(args.meeting_no, token)
            log(f"找到会议: {topic} (id={meeting_id})")

            minutes_url, duration_ms = get_recording_info(meeting_id, token)
            duration_seconds = duration_ms // 1000
            log(f"录制时长: {duration_seconds // 60}分{duration_seconds % 60}秒")

            # Extract minute_token from minutes URL, then get media download URL
            # Media API requires user_access_token (minutes belong to the organizer)
            minute_token = extract_minute_token(minutes_url)
            log(f"妙记 token: {minute_token}")
            user_token = get_user_token(args.open_id, cfg)
            media_url = get_media_download_url(minute_token, user_token)

            tmp_dir = tempfile.mkdtemp(prefix='feishu-minutes-')
            video_path = os.path.join(tmp_dir, 'recording.mp4')
            download_recording(media_url, video_path)

        # Transcribe
        timestamped, plain = transcribe(video_path)

        result = {
            'transcript': plain,
            'transcript_timestamped': timestamped,
        }
        if topic != '未命名会议':
            result['meeting_topic'] = topic
        if meeting_id:
            result['meeting_id'] = meeting_id
            result['meeting_no'] = args.meeting_no
        if duration_seconds:
            result['duration_seconds'] = duration_seconds
        result['reply'] = f"会议「{topic}」转写完成" + (f"，时长 {duration_seconds // 60} 分钟" if duration_seconds else "")

        out(result)

    finally:
        if tmp_dir and not args.keep_files:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            log("临时文件已清理")
        elif tmp_dir:
            log(f"临时文件保留在: {tmp_dir}")


if __name__ == '__main__':
    main()
