import sys
import os
import re
import time
import random
import logging
import threading
from datetime import datetime, timezone
from datetime import time as time_of_day
from typing import List, Dict, Optional, Any


from supabase import create_client, Client
from dotenv import load_dotenv

# backend.config reads the environment at import time, so load the repo-root .env
# before importing anything that depends on it (backend configuration).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(_REPO_ROOT, '.env'))
load_dotenv()

from .monitor import CourseMonitor
from .config import MonitorConfig, CourseConfig
from .email_sender import EmailSender
from ..course_capacity import capacity_limit, format_enrolled
from .api_client import NTUSTCourseAPI
from .semester import get_default_semester
from .utils import setup_logging
from .crypto import CryptoManager


# 打學校的節奏由 worker 決定，不是使用者設定說了算：2026-09-16 實測 Supabase 的
# check_interval 有帳號存著 30（毫秒），worker 照著跑就變成每 1–5 秒打一次課程查詢 API。
# 任何來源的設定都先夾到這個下限再用。下限本身 2026-09-16 由使用者裁示自 15 秒調為 5 秒
# （加上隨機後實際 5–10 秒一次）；學校公告嚴禁機器人搶課，調低是使用者自己承擔的取捨。
MIN_CHECK_INTERVAL_SECONDS = 5.0


# 校務帳密快取上限（秒）；見 _apply_user_settings。


def _safe_check_interval(value: Any, default: float = MIN_CHECK_INTERVAL_SECONDS) -> float:
    """設定值（秒）夾到 MIN_CHECK_INTERVAL_SECONDS 以上；壞值一律回 default。"""
    try:
        interval = float(value)
    except (TypeError, ValueError):
        return default
    if interval != interval or interval <= 0:  # NaN 或非正數
        return default
    return max(MIN_CHECK_INTERVAL_SECONDS, interval)


# 收件人若來自使用者輸入就可能夾帶換行，直接塞進 MIME 標頭等於開 header injection。
_EMAIL_RE = re.compile(r"^[^@\s,;:<>\"\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def _valid_email(value: Any) -> str:
    text = str(value or "").strip()
    return text if _EMAIL_RE.match(text) else ""


def _resolve_recipient(auth_email: str, notify_email: Any, has_own_sender: bool) -> str:
    """通知要寄到哪裡。

    預設是帳號的 Auth 信箱。只有在這個使用者自己備有寄件憑證（per-user SMTP 或 Resend）
    時才允許自訂收件人；沒有的話會用到 worker 的全域寄件設定，那就等於讓任何人拿它
    往任意地址寄信，所以一律回退。格式不合的值同樣忽略。
    """
    if not has_own_sender:
        return auth_email
    return _valid_email(notify_email) or auth_email


def _parse_clock(value: Any) -> Optional[time_of_day]:
    """'HH:MM' / 'HH:MM:SS'（Postgres time 欄位）轉 time；空值或壞值回 None。"""
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            continue
    return None


def _within_monitor_window(start: Any, end: Any, moment: Optional[datetime] = None) -> bool:
    """現在是否落在使用者設定的每日監控時段（台灣時間）。

    兩欄任一為空＝不限制，整天都監控（舊帳號沒設就維持原本行為）。
    起點晚於終點視為跨午夜，例如 08:00–02:00 表示早上八點到隔天凌晨兩點。
    """
    start_time = _parse_clock(start)
    end_time = _parse_clock(end)
    if start_time is None or end_time is None:
        return True
    if start_time == end_time:
        return True
    current = (moment or now_tw()).time()
    if start_time < end_time:
        return start_time <= current < end_time
    return current >= start_time or current < end_time


def _next_interval(base_interval: float, rand_range: float) -> float:
    """下一輪等待秒數：下限之上再往「上」抖動。

    抖動若是 ±rand_range 再夾下限，落在下限以下的那一半會全部堆在 15.000 秒，
    等於一半的請求是固定節拍——那正是要避免的機器人特徵。改成只往上加，
    每一輪都是 [base, base + rand_range) 之間的隨機值，且永遠不低於下限。
    """
    base = max(MIN_CHECK_INTERVAL_SECONDS, base_interval)
    if rand_range <= 0:
        return base
    return base + random.uniform(0, rand_range)


from ..time_utils import now as now_tw
try:
    from ..logging_setup import configure_worker_logging, get_logger
except ImportError:  # pragma: no cover - supports `uvicorn app:app --app-dir backend`
    from logging_setup import configure_worker_logging, get_logger

# worker 是進入點：在這裡設定一次檔案與主控台 handler。
# 模組本身只 get_logger，不設定，所以後端 import 到 monitor 模組時不會產生日誌檔。
logger = get_logger(__name__)


class SupabaseMonitor(CourseMonitor):
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.supabase: Client = create_client(supabase_url, supabase_key)
        
        # Initialize with empty config, will be updated in loop
        initial_config = MonitorConfig(courses=[])
        super().__init__(initial_config)
        
        self.user_settings_id = None
        self.user_id = None
        self.is_active = True  # Master switch status
        self.users_data: List[Dict] = []  # All users' settings + courses
        self.course_states_per_user: Dict[str, Dict] = {}  # Per-user course states (prevent cross-user contamination)

        # Email notification
        self.email_sender = EmailSender()
        self.user_email_map: Dict[str, str] = {}
        self.user_email_notify_map: Dict[str, bool] = {}
        self.user_smtp_map: Dict[str, Dict] = {}
        self.user_resend_map: Dict[str, str] = {}  # user_id -> Resend API Key（每位使用者自有 Key）
        self.user_notify_email_map: Dict[str, str] = {}  # user_id -> 自訂收件人（見 _resolve_recipient）
        self._system_log_lock = threading.Lock()
        self._user_workers: Dict[str, Dict[str, Any]] = {}
        
        self.crypto = CryptoManager()

    def _resolve_log_user_id(self, user_id: Optional[str] = None) -> Optional[str]:
        """Resolve target user_id for system_logs writes with thread-local priority."""
        return user_id or self.user_id

    def _normalize_log_level(self, level: str) -> str:
        """Normalize log type before writing to DB for consistent frontend rendering."""
        normalized = (level or 'info').lower()
        if normalized == 'warning':
            return 'warn'
        if normalized in {'info', 'success', 'warn', 'error', 'heartbeat'}:
            return normalized
        return 'info'

    def _db_update_with_retry(
        self,
        table: str,
        data: Dict,
        match_col: str,
        match_val: Any,
        attempts: int = 3,
        extra_filters: Optional[List[tuple[str, str, Any]]] = None,
    ) -> Any:
        """Run a Supabase update, retrying on transient transport errors.

        The HTTP/2 connection to Supabase is sometimes closed server-side
        (ConnectionTerminated / Server disconnected); the pooled client does not
        transparently reconnect, so the next call after a short pause succeeds.
        """
        last_err: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                query = self.supabase.table(table).update(data).eq(match_col, match_val)
                for operator, column, value in extra_filters or []:
                    query = getattr(query, operator)(column, value)
                return query.execute()
            except Exception as e:
                last_err = e
                if attempt < attempts - 1:
                    time.sleep(0.3 * (attempt + 1))
        assert last_err is not None
        raise last_err

    def _insert_system_log(self, user_id: str, level: str, message: str) -> bool:
        """Insert into system_logs with a small retry to tolerate transient failures."""
        log_level = self._normalize_log_level(level)
        for attempt in range(2):
            try:
                with self._system_log_lock:
                    self.supabase.table('system_logs').insert({
                        'user_id': user_id,
                        'type': log_level,
                        'message': message,
                        'created_at': datetime.now(timezone.utc).isoformat()
                    }).execute()
                return True
            except Exception as e:
                if attempt == 1:
                    logger.error(f"寫入 Supabase 日誌失敗（uid={user_id[:8]}）：{e}")
                else:
                    time.sleep(0.15)
        return False

    def _add_system_notification(self, message: str, level: str = "info") -> None:
        """Override to write to Supabase system_logs.

        當由加選執行緒呼叫時，優先使用 thread-local 中儲存的 user_id（快照），
        避免 self.user_id 被主迴圈切換到其他使用者後寫入錯誤帳號的日誌。
        """
        super()._add_system_notification(message, level)

        # 加選執行緒呼叫時，使用 thread-local 儲存的 user_id；主迴圈呼叫時，使用 self.user_id
        user_id = self._resolve_log_user_id()

        if not user_id:
            logger.warning(f"無法寫入日誌：未設定使用者 ID（訊息：{message}）")
            return

        if self._insert_system_log(user_id, level, message):
            logger.info(f"[通知] {message}")

        # Email notification for important events
        should_email = (
            level == 'success' or
            (level == 'error' and '加選' in message)
        )
        if should_email and self.user_email_notify_map.get(user_id):
            smtp = self.user_smtp_map.get(user_id)
            resend_key = self.user_resend_map.get(user_id)
            to_email = _resolve_recipient(
                self.user_email_map.get(user_id) or '',
                self.user_notify_email_map.get(user_id),
                bool(smtp or resend_key),
            )
            if to_email:
                try:
                    kw = dict(
                        smtp_host=smtp.get('host'),
                        smtp_port=smtp.get('port'),
                        smtp_username=smtp.get('username'),
                        smtp_password=smtp.get('password'),
                    ) if smtp else {}
                    if resend_key:
                        kw['resend_api_key'] = resend_key
                    prefix = {'success': '✅', 'error': '❌'}.get(level, '')
                    subject = f"{prefix} NTUST Monitor — {message[:60]}"
                    self.email_sender.send_async(to_email, subject, message, level, **kw)
                except Exception as e:
                    logger.warning(f"發送通知 Email 失敗（uid={user_id[:8]}）: {e}")

    def _add_notification(self, course: CourseConfig, current_count: int, course_info: Dict, previous_remaining: Optional[int] = None) -> None:
        """Override to write availability changes to Supabase system_logs"""
        super()._add_notification(course, current_count, course_info, previous_remaining)

        restrict1_int = capacity_limit(course_info, getattr(self, 'enrollment_period', 'A06'))
        if restrict1_int is not None:
            remaining = restrict1_int - current_count

            # Skip notification on initial check (previous_remaining is None = no actual change)
            if previous_remaining is None:
                return

            msg = f"名額變動: {course.alias} ({course.course_no}) - 剩餘: {remaining} (限制: {restrict1_int}, 已選: {current_count})"
            self._add_system_notification(msg, level="success" if remaining > 0 else "warn")

    def _reset_user_caches(self) -> None:
        self.users_data = []
        # The auth email cache survives configuration refreshes.
        self.user_email_notify_map = {}
        self.user_smtp_map = {}
        self.user_resend_map = {}
        self.user_notify_email_map = {}

    def _current_semester_or_blank(self) -> str:
        """過期學期判定用；取不到就回空字串，這一輪不判定任何課程過期。"""
        try:
            return get_default_semester()
        except Exception as e:
            logger.warning(f"無法取得當前學期，本輪不判定課程是否過期：{e}")
            return ''

    def _apply_notification_settings(self, settings: Dict) -> None:
        """解析單一使用者的通知設定，不讀課程或校務帳密。"""
        user_id = settings.get('user_id')
        is_encrypted = settings.get('is_encrypted', False)

        raw_smtp_password = settings.get('smtp_password') or ''
        raw_resend_api_key = settings.get('resend_api_key') or ''
        smtp_password = raw_smtp_password
        resend_api_key = raw_resend_api_key

        if not is_encrypted and (raw_smtp_password or raw_resend_api_key):
            # 前端寫入明文並把 is_encrypted 設 false；這裡加密後寫回
            if self.crypto.fernet is None:
                logger.error(f"使用者 {user_id[:8]} 有敏感資料但未設定加密金鑰，略過自動加密")
            else:
                # 前端只改其中一個密碼時會把整列標成未加密，其他欄位仍是密文；
                # 已能解密的欄位視為已加密，不可再加密一次（否則永遠解不開）。
                def _ensure_encrypted(raw: str) -> str:
                    if self.crypto.is_ciphertext(raw):
                        return raw
                    return self.crypto.encrypt(raw)

                update_data = {'is_encrypted': True}
                if raw_smtp_password:
                    update_data['smtp_password'] = _ensure_encrypted(raw_smtp_password)
                    smtp_password = self.crypto.decrypt(update_data['smtp_password'])
                if raw_resend_api_key:
                    update_data['resend_api_key'] = _ensure_encrypted(raw_resend_api_key)
                    resend_api_key = self.crypto.decrypt(update_data['resend_api_key'])

                try:
                    self.supabase.table('user_settings').update(update_data).eq('user_id', user_id).execute()
                    logger.info(f"已將使用者 {user_id[:8]} 的通知密鑰加密並寫回資料庫")
                except Exception as e:
                    logger.error(f"加密寫回資料庫失敗: {e}")
        elif is_encrypted:
            if self.crypto.fernet is None:
                logger.error(f"使用者 {user_id[:8]} 的設定標記為已加密，但加密金鑰不可用，將跳過通知密鑰")
                smtp_password = ''
                resend_api_key = ''
            else:
                if smtp_password:
                    smtp_password = self.crypto.decrypt(smtp_password)
                if resend_api_key:
                    resend_api_key = self.crypto.decrypt(resend_api_key)

        email_notify = settings.get('email_notify', False)
        self.user_email_notify_map[user_id] = email_notify

        resend_key = resend_api_key.strip()
        if resend_key:
            self.user_resend_map[user_id] = resend_key

        smtp_user = (settings.get('smtp_username') or '').strip()
        if smtp_user and smtp_password:
            self.user_smtp_map[user_id] = {
                'host': (settings.get('smtp_host') or os.environ.get('SMTP_HOST', '')).strip(),
                'port': int(settings.get('smtp_port') or 587),
                'username': smtp_user,
                'password': smtp_password,
            }

        notify_email = _valid_email(settings.get('notify_email'))
        if notify_email:
            self.user_notify_email_map[user_id] = notify_email

        if email_notify and (
            self.email_sender.configured
            or user_id in self.user_smtp_map
            or user_id in self.user_resend_map
        ):
            self._lookup_auth_email(user_id)

    def _apply_user_settings(self, settings: Dict, current_semester: str) -> bool:
        """把一列 user_settings 解析進 users_data 與各張通知對照表。

        一筆壞掉的設定不應讓其他使用者跟著讀取失敗，所以例外在這裡吃掉。
        """
        try:
            user_id = settings.get('user_id')
            self._apply_notification_settings(settings)

            # Fetch courses belonging to THIS user only
            courses_response = self.supabase.table('monitored_courses').select('*').eq('user_id', user_id).execute()

            user_courses = []
            for c_data in courses_response.data:
                if c_data.get('status') in ('paused', 'enrolled', 'expired'):
                    continue
                if self._expire_if_past_semester(c_data, current_semester):
                    continue
                course = CourseConfig(
                    course_no=c_data.get('course_code', ''),
                    course_name=c_data.get('course_name', ''),
                    semester=c_data.get('semester') or get_default_semester(verify_ssl=settings.get('verify_ssl', True)),
                    alias=c_data.get('course_name', ''),
                )
                course.db_id = c_data.get('id')
                user_courses.append(course)

            check_interval_ms = settings.get('check_interval') or 30000
            self.users_data.append({
                'user_id': user_id,
                'check_interval': _safe_check_interval(check_interval_ms / 1000.0),
                'random_interval': settings.get('random_interval', 5),
                'is_active': settings.get('is_active', True),
                'verify_ssl': settings.get('verify_ssl', True),
                'courses': user_courses,
                'notify_email': settings.get('notify_email'),
                'monitor_window_start': settings.get('monitor_window_start'),
                'monitor_window_end': settings.get('monitor_window_end'),
                'enrollment_period': (settings.get('enrollment_period') or 'A06').strip() or 'A06',  # A06=電腦抽選後選課, B01=加退選課
                # Proxy settings
                'proxy_enabled': settings.get('proxy_enabled', False),
                'proxy_type': str(settings.get('proxy_type') or 'socks5'),
                'proxy_host': str(settings.get('proxy_host') or ''),
                'proxy_port': str(settings.get('proxy_port') or ''),
                'proxy_username': str(settings.get('proxy_username') or ''),
                'proxy_password': str(settings.get('proxy_password') or ''),
            })
            return True
        except Exception as e:
            uid = str(settings.get('user_id') or '?')[:8]
            logger.error(f"使用者 {uid} 的設定解析失敗，已略過：{e}", exc_info=True)
            return False

    def fetch_config_for_user(self, user_id: str) -> bool:
        """只讀這一位使用者的設定。

        每位使用者有自己的執行緒，而每條執行緒每 60 秒都要重讀一次設定。走 fetch_config()
        的話那是「整張 user_settings ＋ 每位使用者各一輪 monitored_courses／校務帳密／Auth
        Email」，n 位使用者就是 n 條執行緒各做 n 份工，O(n²) 次雲端往返全部疊在兩次查學校
        之間，實測讓 5 秒的間隔變成 13–15 秒（2026-09-16）。這裡只抓自己那一列。
        """
        try:
            response = (
                self.supabase.table('user_settings').select('*').eq('user_id', user_id).execute()
            )
            if not response.data:
                logger.warning(f"Supabase 查無使用者 {user_id[:8]} 的設定。")
                return False
            self._reset_user_caches()
            return self._apply_user_settings(response.data[0], self._current_semester_or_blank())
        except Exception as e:
            logger.error(f"讀取使用者 {user_id[:8]} 設定失敗：{e}")
            return False

    def fetch_config(self) -> bool:
        """Fetch the minimal user list needed by the manager loop.

        管理執行緒用這支決定該開／關哪些使用者執行緒；單一使用者的迴圈請用
        fetch_config_for_user()。這裡不讀課程、校務帳密或 Auth Email。
        """
        try:
            settings_response = self.supabase.table('user_settings').select('user_id, is_active').execute()
            if not settings_response.data:
                logger.warning("Supabase 中尚無使用者設定。")
                return False

            self._reset_user_caches()
            self.users_data = [
                {
                    'user_id': settings.get('user_id'),
                    'is_active': settings.get('is_active', True),
                    'courses': [],
                }
                for settings in settings_response.data
                if settings.get('user_id')
            ]

            return True

        except Exception as e:
            logger.error(f"讀取設定失敗：{e}")
            return False

    def _expire_if_past_semester(self, c_data: Dict, current_semester: str) -> bool:
        """學期已結束的課程停止輪詢：名額不會再變，每幾秒查一次只是白打學校 API。

        只認「嚴格早於當前學期」；等於或晚於都保留，使用者可以預先加下學期的課。
        學期字串同為 4 碼（1141、114H），直接字串比較即可排序。
        """
        semester = str(c_data.get('semester') or '').strip()
        if not current_semester or not semester or semester >= current_semester:
            return False
        course_code = c_data.get('course_code', '')
        try:
            # 一併清掉人數：停止輪詢後這個數字不會再更新，留著會被當成現況
            self._db_update_with_retry(
                'monitored_courses', {'status': 'expired', 'current_enrolled': None}, 'id', c_data.get('id')
            )
        except Exception as e:
            logger.error(f"標記過期課程失敗 {course_code}：{e}")
            return False
        logger.info(f"課程 {course_code}（學期 {semester}）早於當前學期 {current_semester}，停止監控")
        user_id = c_data.get('user_id')
        if user_id:
            self._write_log(
                f"「{c_data.get('course_name') or course_code}」屬於學期 {semester}，已結束，停止監控"
                f"（目前學期 {current_semester}）。若要繼續監控請在課程設定改成目前學期。",
                level='warn', user_id=user_id,
            )
        return True

    def _lookup_auth_email(self, user_id: Optional[str]) -> str:
        """由 Supabase Auth 取得帳號信箱（快取於 user_email_map）。"""
        if not user_id:
            return ''
        cached = self.user_email_map.get(user_id)
        if cached:
            return cached
        try:
            auth_resp = self.supabase.auth.admin.get_user_by_id(user_id)
            email = (getattr(getattr(auth_resp, 'user', None), 'email', None) or '').strip()
        except Exception as e:
            logger.warning(f"取得使用者 Email 失敗（{user_id[:8]}）：{e}")
            return ''
        if email:
            self.user_email_map[user_id] = email
        return email

    def _process_test_email_requests(self) -> None:
        """處理待發送的測試信請求（email_test_requests 表）。"""
        try:
            resp = self.supabase.table('email_test_requests').select('id, user_id, email').is_('sent_at', 'null').order('created_at').limit(20).execute()
            if not resp.data:
                return
            request_user_ids = sorted({row.get('user_id') for row in resp.data if row.get('user_id')})
            if request_user_ids:
                settings_resp = (
                    self.supabase.table('user_settings')
                    .select(
                        'user_id, email_notify, notify_email, resend_api_key, smtp_host, '
                        'smtp_port, smtp_username, smtp_password, is_encrypted'
                    )
                    .in_('user_id', request_user_ids)
                    .execute()
                )
                for settings in settings_resp.data:
                    self._apply_notification_settings(settings)
            for row in resp.data:
                req_id = row['id']
                user_id = row.get('user_id')
                # 前端寫入的 email 欄位不可信（可被改成任意地址），一律忽略。
                # 收件人走跟通知信同一條規則：預設 Auth 信箱，自備寄件憑證才可自訂。
                smtp_for_user = self.user_smtp_map.get(user_id) if user_id else None
                resend_for_user = self.user_resend_map.get(user_id) if user_id else None
                to_email = _resolve_recipient(
                    self._lookup_auth_email(user_id) or '',
                    self.user_notify_email_map.get(user_id) if user_id else None,
                    bool(smtp_for_user or resend_for_user),
                )
                if not to_email:
                    self.supabase.table('email_test_requests').update({
                        'sent_at': datetime.now(timezone.utc).isoformat(),
                        'error': '無法取得帳號信箱，請重新登入後再試'
                    }).eq('id', req_id).execute()
                    continue
                smtp = self.user_smtp_map.get(user_id) if user_id else None
                kw = dict(
                    smtp_host=smtp.get('host') if smtp else None,
                    smtp_port=smtp.get('port') if smtp else None,
                    smtp_username=smtp.get('username') if smtp else None,
                    smtp_password=smtp.get('password') if smtp else None,
                ) if smtp else {}
                resend_key = self.user_resend_map.get(user_id) if user_id else None
                if resend_key:
                    kw['resend_api_key'] = resend_key
                if not self.email_sender._is_configured(
                    kw.get('smtp_host'), kw.get('smtp_port'),
                    kw.get('smtp_username'), kw.get('smtp_password'),
                    kw.get('resend_api_key'),
                ):
                    self.supabase.table('email_test_requests').update({
                        'sent_at': datetime.now(timezone.utc).isoformat(),
                        'error': '尚未設定 Email 發送方式（請於設定頁填寫 Resend API Key 或 SMTP）'
                    }).eq('id', req_id).execute()
                    continue
                subject = "NTUST Monitor — 測試信"
                message = "這是一封測試信。若您收到此信，表示 Email 通知已正常運作。"
                try:
                    self.email_sender.send_sync(to_email, subject, message, 'info', **kw)
                    self.supabase.table('email_test_requests').update({
                        'sent_at': datetime.now(timezone.utc).isoformat()
                    }).eq('id', req_id).execute()
                    logger.info(f"測試信已發送至 {to_email}")
                except Exception as e:
                    err_msg = str(e)[:500]
                    self.supabase.table('email_test_requests').update({
                        'sent_at': datetime.now(timezone.utc).isoformat(),
                        'error': err_msg
                    }).eq('id', req_id).execute()
                    logger.warning(f"測試信發送失敗（{to_email}）：{e}")
        except Exception as e:
            logger.debug(f"處理測試信請求時發生錯誤：{e}")

    def check_course(self, course: CourseConfig) -> bool:
        """Override to update Supabase with course status"""
        success = super().check_course(course)
        
        if hasattr(course, 'db_id'):
            try:
                identifier = self._get_course_identifier(course)
                state = self.get_course_state(identifier)
                
                if state:
                    course_info = state.get('course_info', {})
                    current_count = state.get('count', 0)
                    enrolled_str = format_enrolled(course_info, getattr(self, 'enrollment_period', 'A06'))
                    course_semester = (course_info.get('Semester') or course.semester or '').strip()
                    update_data = {
                        'course_name': course_info.get('CourseName', course.course_name),
                        'current_enrolled': enrolled_str,
                        'last_check_time': datetime.now(timezone.utc).isoformat(),
                    }
                    # 只接受更新的學期，避免舊學期資料回寫覆蓋
                    if course_semester and (not course.semester or course_semester > course.semester):
                        course.semester = course_semester
                        update_data['semester'] = course_semester
                    # 用條件更新原子地保護已加選狀態；常態只需一次請求。
                    status_update_data = {**update_data, 'status': 'monitoring'}
                    logger.info(f"  ✓ {course.alias}（{course.course_no}）→ {enrolled_str}")
                    outage = self._note_query_success(identifier)
                    if outage is not None:
                        self._write_log(
                            f"✓ {course.alias}（{course.course_no}）查詢已恢復（不穩定持續約 {int(outage // 60)} 分 {int(outage % 60)} 秒）",
                            level="info",
                        )
                    previous_count = state.get('previous_count')
                    if previous_count is not None and previous_count != current_count:
                        self._write_log(
                            f"名額變動：{course.alias}（{course.course_no}）→ {enrolled_str}",
                            level="info",
                        )
                    update_response = self._db_update_with_retry(
                        'monitored_courses',
                        status_update_data,
                        'id',
                        course.db_id,
                        extra_filters=[('neq', 'status', 'enrolled')],
                    )
                    if not getattr(update_response, 'data', None):
                        # enrolled 列仍維持舊行為：更新人數與檢查時間，但不動 status。
                        self._db_update_with_retry(
                            'monitored_courses',
                            update_data,
                            'id',
                            course.db_id,
                            extra_filters=[('eq', 'status', 'enrolled')],
                        )
                else:
                    update_data = {
                        'last_check_time': datetime.now(timezone.utc).isoformat(),
                        'status': 'error',
                        'current_enrolled': 'Error'
                    }
                    logger.warning(f"  ✗ {course.alias}（{course.course_no}）→ 查詢失敗")
                    # 節流：只有 check_course 這一輪允許寫入時才同步寫這行，避免尖峰刷屏
                    if self._query_fail_last_logged.get(identifier, 0) >= time.time() - 2:
                        self._write_log(f"✗ {course.alias}（{course.course_no}）→ 查詢失敗", level="error")
                
                    self._db_update_with_retry('monitored_courses', update_data, 'id', course.db_id)
                    
            except Exception as e:
                logger.error(f"更新課程資料失敗 {course.alias}：{e}")
                
        return success

    def _build_proxies(self, user_data: Dict) -> Optional[Dict]:
        """Build a requests-compatible proxies dict from user proxy settings."""
        if not user_data.get('proxy_enabled'):
            return None
        proxy_type = user_data.get('proxy_type', 'socks5').lower()
        host = user_data.get('proxy_host', '').strip()
        port = user_data.get('proxy_port', '').strip()
        if not host or not port:
            return None
        username = user_data.get('proxy_username', '').strip()
        password = user_data.get('proxy_password', '').strip()
        if username and password:
            auth = f"{username}:{password}@"
        else:
            auth = ''
        proxy_url = f"{proxy_type}://{auth}{host}:{port}"
        return {'http': proxy_url, 'https': proxy_url}

    def _write_log(self, message: str, level: str = "info", user_id: Optional[str] = None) -> None:
        """Write a message directly to system_logs for the Live Console."""
        target_user_id = self._resolve_log_user_id(user_id)
        if not target_user_id:
            return
        if not self._insert_system_log(target_user_id, level, message):
            logger.warning(f"寫入即時日誌失敗（uid={target_user_id[:8]}）")

    def _send_heartbeat(self):
        """Send a heartbeat log to indicate worker is alive"""
        try:
            target_user_id = self._resolve_log_user_id()
            if target_user_id:
                self._insert_system_log(target_user_id, 'heartbeat', 'ping')
        except Exception:
            pass # Ignore heartbeat errors

    def resolve_pending_courses(self) -> int:
        """Query NTUST API for any pending courses and fill in course name/enrollment."""
        try:
            pending_resp = self.supabase.table('monitored_courses').select('*').eq('status', 'pending').execute()
            if not pending_resp.data:
                return 0

            logger.info(f"發現 {len(pending_resp.data)} 門待處理課程，正在查詢資訊...")

            pending_user_ids = sorted({
                row.get('user_id') for row in pending_resp.data if row.get('user_id')
            })
            settings_rows = []
            if pending_user_ids:
                settings_resp = (
                    self.supabase.table('user_settings')
                    .select('user_id, verify_ssl, enrollment_period')
                    .in_('user_id', pending_user_ids)
                    .execute()
                )
                settings_rows = settings_resp.data

            # 只有真的有 pending 課程時才讀這兩個設定，不加重 manager 的穩態輪詢。
            verify_ssl_by_user = {
                u.get('user_id'): bool(u.get('verify_ssl', True)) for u in settings_rows if u.get('user_id')
            }
            verify_period = {
                u.get('user_id'): u.get('enrollment_period', 'A06') for u in settings_rows if u.get('user_id')
            }
            api_by_verify: Dict[bool, NTUSTCourseAPI] = {}

            for course_data in pending_resp.data:
                course_code = course_data.get('course_code', '').strip()
                if not course_code:
                    continue
                try:
                    verify_ssl = verify_ssl_by_user.get(course_data.get('user_id'), True)
                    api = api_by_verify.get(verify_ssl)
                    if api is None:
                        api = api_by_verify[verify_ssl] = NTUSTCourseAPI(verify_ssl=verify_ssl)
                    c = api.get_course_by_code(course_code, semester=course_data.get('semester') or '', course_name=course_data.get('course_name') or '')
                    if c:
                        enrolled_str = format_enrolled(c, verify_period.get(course_data.get('user_id'), 'A06'))
                        update_data = {
                            'course_name': c.get('CourseName', course_code),
                            'current_enrolled': enrolled_str,
                            'status': 'monitoring',
                            'last_check_time': datetime.now(timezone.utc).isoformat()
                        }
                        c_semester = (c.get('Semester') or '').strip()
                        if c_semester:
                            update_data['semester'] = c_semester
                        self._db_update_with_retry('monitored_courses', update_data, 'id', course_data['id'])
                        logger.info(f"  解析完成：{course_code} → {c.get('CourseName', course_code)}（{enrolled_str}）")
                    else:
                        logger.warning(f"  找不到課程：{course_code}")
                except Exception as e:
                    logger.error(f"  解析課程失敗 {course_code}：{e}")
            return len(pending_resp.data)
        except Exception as e:
            logger.error(f"待處理課程查詢失敗：{e}")
        return 0

    def _log_separator(self, label: str = "") -> None:
        line = "─" * 60
        if label:
            msg = f"┤ {label} ├"
            pad = (60 - len(msg)) // 2
            line = "─" * pad + msg + "─" * (60 - pad - len(msg))
        logger.info(line)

    def _start_user_worker(self, user_id: str) -> None:
        if user_id in self._user_workers:
            return
        stop_event = threading.Event()
        t = threading.Thread(
            target=self._run_user_loop,
            args=(user_id, stop_event),
            daemon=True,
            name=f"UserWorker-{user_id[:8]}",
        )
        self._user_workers[user_id] = {"thread": t, "stop_event": stop_event}
        t.start()
        logger.info(f"[manager] 已啟動使用者執行緒: {user_id[:8]}")

    def _stop_user_worker(self, user_id: str) -> None:
        worker = self._user_workers.get(user_id)
        if not worker:
            return
        worker["stop_event"].set()
        worker["thread"].join(timeout=5)
        self._user_workers.pop(user_id, None)
        logger.info(f"[manager] 已停止使用者執行緒: {user_id[:8]}")

    def _run_user_loop(self, user_id: str, stop_event: threading.Event) -> None:
        """Per-user dedicated loop; isolated monitor instance to prevent cross-user interference."""
        user_monitor = SupabaseMonitor(self.supabase_url, self.supabase_key)
        uid_short = user_id[:8]
        HEARTBEAT_INTERVAL = 60
        CONFIG_REFRESH_INTERVAL = 60
        next_check_at = 0.0
        last_heartbeat_at = 0.0
        resting_logged = False  # 非監控時段只記一次，不要每 20 秒洗版
        last_config_fetch_at = 0.0
        cached_user_data: Optional[Dict[str, Any]] = None

        def _wait(seconds: float) -> bool:
            """Wait and return True if stop requested."""
            return stop_event.wait(timeout=max(0.1, seconds))

        try:
            while not stop_event.is_set():
                now = time.time()

                if (now - last_config_fetch_at) >= CONFIG_REFRESH_INTERVAL or cached_user_data is None:
                    if not user_monitor.fetch_config_for_user(user_id):
                        logger.warning(f"[{uid_short}] 讀取設定失敗，3 秒後重試")
                        if _wait(3):
                            break
                        continue
                    cached_user_data = next((u for u in user_monitor.users_data if u.get('user_id') == user_id), None)
                    last_config_fetch_at = now

                if cached_user_data is None:
                    if _wait(2):
                        break
                    continue

                if now - last_heartbeat_at >= HEARTBEAT_INTERVAL:
                    try:
                        # Piggyback the latest school-API latency on the heartbeat so the
                        # dashboard can show it without a separate (noisy) log row.
                        api_latency_ms = getattr(user_monitor.api, 'last_request_latency_ms', None)
                        hb_msg = 'ping'
                        if api_latency_ms is not None:
                            hb_msg = f"ping 延遲指標：學校系統 {api_latency_ms:.0f}ms"
                        user_monitor._insert_system_log(user_id, 'heartbeat', hb_msg)
                    except Exception:
                        pass
                    last_heartbeat_at = now

                if not cached_user_data.get('is_active') or not cached_user_data.get('courses'):
                    next_check_at = 0.0
                    if _wait(1.5):
                        break
                    continue

                # 監控時段外整輪跳過：連課程查詢都不打，只有心跳（上面那段）照常，
                # 儀表板才看得出 Worker 還活著而不是掛了。
                if not _within_monitor_window(
                    cached_user_data.get('monitor_window_start'),
                    cached_user_data.get('monitor_window_end'),
                ):
                    next_check_at = 0.0
                    if not resting_logged:
                        logger.info(
                            f"[{uid_short}] 非監控時段"
                            f"（{cached_user_data.get('monitor_window_start')}–{cached_user_data.get('monitor_window_end')}）"
                            f"，暫停查詢"
                        )
                        resting_logged = True
                    if _wait(20):
                        break
                    continue
                if resting_logged:
                    logger.info(f"[{uid_short}] 進入監控時段，恢復查詢")
                    resting_logged = False

                if now < next_check_at:
                    heartbeat_wait = HEARTBEAT_INTERVAL - (now - last_heartbeat_at)
                    wait_s = min(next_check_at - now, max(0.5, heartbeat_wait))
                    if _wait(wait_s):
                        break
                    continue

                user_monitor.user_id = user_id
                user_monitor.config.courses = cached_user_data.get('courses', [])
                user_monitor.config.check_interval = _safe_check_interval(cached_user_data.get('check_interval'))
                user_monitor.enrollment_period = cached_user_data.get('enrollment_period', 'A06')

                verify_ssl = cached_user_data.get('verify_ssl', True)
                user_monitor.api.verify_ssl = verify_ssl

                proxies = user_monitor._build_proxies(cached_user_data)
                user_monitor.api.session.proxies = proxies or {}
                n_courses = len(user_monitor.config.courses)
                if proxies:
                    proxy_url = list(proxies.values())[0]
                    pw = cached_user_data.get('proxy_password', '')
                    display_url = proxy_url.replace(pw, '***') if pw else proxy_url
                    start_msg = f"查詢使用代理 {display_url}，開始檢查 {n_courses} 門課程..."
                else:
                    start_msg = f"直接連線，開始檢查 {n_courses} 門課程..."
                logger.info(f"[{uid_short}] {start_msg}")

                user_monitor.course_states = user_monitor.course_states_per_user.get(user_id, {})

                loop_start = time.time()
                user_monitor.check_all_courses(silent=True)
                user_monitor.course_states_per_user[user_id] = user_monitor.course_states

                elapsed = time.time() - loop_start
                base_interval = _safe_check_interval(cached_user_data.get('check_interval'))
                rand_range = float(cached_user_data.get('random_interval', 0) or 0)
                interval = _next_interval(base_interval, rand_range)
                next_check_at = loop_start + interval
                next_time_str = datetime.fromtimestamp(next_check_at).strftime('%H:%M:%S')
                jitter_str = f"（基礎{base_interval:.0f}s ＋隨機 0–{rand_range:.0f}s）" if rand_range > 0 else ""
                summary_msg = f"耗時 {elapsed:.1f}s／間隔 {interval:.0f}s{jitter_str}／下次 {next_time_str}"
                logger.info(f"[{uid_short}] {summary_msg}")

                if _wait(0.2):
                    break
        except Exception as e:
            logger.error(f"[{uid_short}] 使用者執行緒異常: {e}", exc_info=True)
        finally:
            logger.info(f"[{uid_short}] 使用者執行緒結束")

    def run_loop(self):
        """Manager loop: maintain one dedicated worker thread per user."""
        self._log_separator("NTUST 課程監控 Worker 啟動（每位使用者獨立執行緒）")
        MANAGER_INTERVAL = 30
        should_exit = False

        while not should_exit:
            try:
                self.resolve_pending_courses()

                if not self.fetch_config():
                    logger.warning("[manager] 讀取設定失敗，10 秒後重試...")
                    try:
                        self._process_test_email_requests()
                    except Exception:
                        pass
                    time.sleep(10)
                    continue

                self._process_test_email_requests()

                configured_user_ids = {u.get('user_id') for u in self.users_data if u.get('user_id')}

                # 執行緒若因未捕捉例外結束，移出登記表讓下方邏輯重新啟動
                for uid, worker in list(self._user_workers.items()):
                    if not worker["thread"].is_alive():
                        logger.warning(f"[manager] 使用者 {uid[:8]} 的執行緒已停止，將重新啟動")
                        self._user_workers.pop(uid, None)

                running_user_ids = set(self._user_workers.keys())

                for uid in configured_user_ids - running_user_ids:
                    self._start_user_worker(uid)
                for uid in running_user_ids - configured_user_ids:
                    self._stop_user_worker(uid)

                active_users = sum(1 for u in self.users_data if u.get('is_active'))
                logger.info(
                    f"[manager] 使用者 {len(self.users_data)} 位，啟用 {active_users} 位，"
                    f"執行緒 {len(self._user_workers)} 條"
                )
                time.sleep(MANAGER_INTERVAL)

            except KeyboardInterrupt:
                logger.info("使用者中止，正在停止所有使用者執行緒...")
                should_exit = True
            except Exception as e:
                logger.error(f"[manager] 主循環發生錯誤：{e}", exc_info=True)
                time.sleep(10)

        for uid in list(self._user_workers.keys()):
            self._stop_user_worker(uid)

if __name__ == "__main__":
    configure_worker_logging(log_to_console=True)
    # Supabase 設定以 backend/config.py 為單一來源（worker 已在 import 前 load_dotenv）。
    # 缺 service role key 直接失敗：退回 anon key 會讓 app_private 讀取與 session 寫入靜默失敗。
    from ..config import SUPABASE_URL as CFG_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY as CFG_SERVICE_KEY
    from ..credentials import _is_placeholder

    SUPABASE_URL = CFG_SUPABASE_URL or (os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
    if not SUPABASE_URL:
        logger.error("缺少 SUPABASE_URL（或 VITE_SUPABASE_URL），請在 .env 設定")
        sys.exit(1)
    if _is_placeholder(CFG_SERVICE_KEY):
        logger.error("缺少 SUPABASE_SERVICE_ROLE_KEY：worker 需要服務金鑰才能讀 app_private 與寫入 session，不再退回匿名金鑰")
        sys.exit(1)

    logger.info("使用服務金鑰（管理員權限）")
    monitor = SupabaseMonitor(SUPABASE_URL, CFG_SERVICE_KEY)
    monitor.run_loop()
