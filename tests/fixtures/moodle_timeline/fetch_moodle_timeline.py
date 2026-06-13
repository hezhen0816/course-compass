from __future__ import annotations

import csv
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
import urllib3
from bs4 import BeautifulSoup, Tag


OUTPUT_DIR = Path(__file__).resolve().parent
TAIPEI = ZoneInfo("Asia/Taipei")
USERNAME = os.environ.get("NTUST_USERNAME")
PASSWORD = os.environ.get("NTUST_PASSWORD")
TARGET_URL = "https://moodle2.ntust.edu.tw/my/"
DEFAULT_TIMEOUT = 30
VERIFY_SSL = os.environ.get("NTUST_VERIFY_SSL", "false").lower() in {"true", "1", "yes"}

if not USERNAME or not PASSWORD:
    raise SystemExit("Missing NTUST_USERNAME or NTUST_PASSWORD.")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

flow: list[dict[str, str]] = []


def now() -> str:
    return datetime.now(TAIPEI).isoformat()


def record(step: str, url: str, note: str = "") -> None:
    flow.append(
        {
            "step": step,
            "note": note,
            "timestamp": now(),
            "url": url,
        }
    )


def normalize(text: str | None) -> str:
    return (text or "").replace("\xa0", " ").replace("\r", "").strip()


def first_form(soup: BeautifulSoup) -> Tag:
    form = soup.find("form")
    if not isinstance(form, Tag):
        raise RuntimeError("無法找到表單。")
    return form


def parse_hidden_inputs(form: Tag) -> dict[str, str]:
    values: dict[str, str] = {}
    for input_tag in form.find_all("input"):
        if not isinstance(input_tag, Tag):
            continue
        name = input_tag.get("name")
        if not name:
            continue
        input_type = (input_tag.get("type") or "").lower()
        if input_type in {"hidden", ""}:
            values[name] = input_tag.get("value", "")
    return values


def write_json(filename: str, payload: object) -> None:
    (OUTPUT_DIR / filename).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_csv(filename: str, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with (OUTPUT_DIR / filename).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def render_flow_markdown(entries: list[dict[str, str]]) -> str:
    lines = ["# Moodle 時間軸抓取流程紀錄", ""]
    for entry in entries:
        line = f"- {entry['timestamp']} | {entry['step']} | {entry['url']}"
        if entry["note"]:
            line += f" | {entry['note']}"
        lines.append(line)
    lines.append("")
    return "\n".join(lines)


def submit_form(
    session: requests.Session,
    page_response: requests.Response,
    step: str,
    extra_fields: dict[str, str] | None = None,
) -> requests.Response:
    soup = BeautifulSoup(page_response.text, "html.parser")
    form = first_form(soup)
    data = parse_hidden_inputs(form)
    if extra_fields:
        data.update(extra_fields)
    action = urljoin(page_response.url, form.get("action", ""))
    response = session.post(
        action,
        data=data,
        timeout=DEFAULT_TIMEOUT,
        allow_redirects=True,
        verify=VERIFY_SSL,
    )
    response.raise_for_status()
    record(step, response.url, "submitted form")
    return response


def login(session: requests.Session) -> requests.Response:
    entry_response = session.get(
        TARGET_URL,
        timeout=DEFAULT_TIMEOUT,
        allow_redirects=True,
        verify=VERIFY_SSL,
    )
    entry_response.raise_for_status()
    record("open-moodle-entry", entry_response.url, "opened Moodle dashboard entry")

    if "ssoam" not in entry_response.url:
        return entry_response

    login_response = submit_form(
        session,
        entry_response,
        "submit-sso-login",
        {
            "Username": USERNAME,
            "Password": PASSWORD,
            "captcha": "",
        },
    )

    soup = BeautifulSoup(login_response.text, "html.parser")
    callback_form = soup.find("form")
    callback_action = callback_form.get("action", "") if isinstance(callback_form, Tag) else ""
    if isinstance(callback_form, Tag) and "auth/oidc" in callback_action:
        login_response = submit_form(session, login_response, "submit-moodle-oidc")

    if "login" in login_response.url.lower() and "ssoam" in login_response.url:
        (OUTPUT_DIR / "login-timeout.html").write_text(login_response.text, encoding="utf-8")
        raise RuntimeError(f"SSO 登入失敗，仍停留在登入頁：{login_response.url}")

    page_response = session.get(
        TARGET_URL,
        timeout=DEFAULT_TIMEOUT,
        allow_redirects=True,
        verify=VERIFY_SSL,
    )
    page_response.raise_for_status()
    record("open-moodle-dashboard", page_response.url, "loaded Moodle dashboard after login")

    if "login" in page_response.url.lower() or "ssoam" in page_response.url:
        (OUTPUT_DIR / "login-timeout.html").write_text(page_response.text, encoding="utf-8")
        raise RuntimeError(f"登入後沒有成功進入 Moodle 儀表板，目前停在 {page_response.url}")

    return page_response


def extract_timeline_items(soup: BeautifulSoup) -> tuple[str, list[dict[str, object]]]:
    timeline = soup.select_one('[data-region="timeline"]')
    if not isinstance(timeline, Tag):
        raise RuntimeError("找不到 Moodle 時間軸區塊。")

    filter_label = normalize(
        timeline.select_one("#timeline-day-filter-current-selection").get_text(" ", strip=True)
        if timeline.select_one("#timeline-day-filter-current-selection")
        else ""
    )

    event_container = timeline.select_one('[data-region="event-list-container"]')
    view_dates = timeline.select_one('[data-region="view-dates"]')
    if not isinstance(event_container, Tag) or not isinstance(view_dates, Tag):
        raise RuntimeError("找不到時間軸 API 設定。")

    timeline_config = {
        "filterLabel": filter_label,
        "midnight": int(event_container.get("data-midnight", "0")),
        "daysLimit": int(event_container.get("data-days-limit", "7")),
        "limitNum": int(view_dates.get("data-limit", "5")) + 1,
    }
    return timeline_config, []


def fetch_timeline_items(
    session: requests.Session,
    html: str,
    timeline_config: dict[str, int | str],
) -> list[dict[str, object]]:
    sesskey_match = re.search(r'"sesskey":"([^"]+)"', html)
    if not sesskey_match:
        raise RuntimeError("找不到 Moodle sesskey。")

    payload = [
        {
            "index": 0,
            "methodname": "core_calendar_get_action_events_by_timesort",
            "args": {
                "limitnum": int(timeline_config["limitNum"]),
                "timesortfrom": int(timeline_config["midnight"]),
                "timesortto": int(timeline_config["midnight"]) + int(timeline_config["daysLimit"]) * 86400,
                "limittononsuspendedevents": True,
            },
        }
    ]

    response = session.post(
        (
            "https://moodle2.ntust.edu.tw/lib/ajax/service.php"
            f"?sesskey={sesskey_match.group(1)}&info=core_calendar_get_action_events_by_timesort"
        ),
        json=payload,
        timeout=DEFAULT_TIMEOUT,
        allow_redirects=True,
        verify=VERIFY_SSL,
    )
    response.raise_for_status()
    record("fetch-timeline-api", response.url, "loaded timeline action events JSON")

    data = response.json()
    if not data or data[0].get("error"):
        raise RuntimeError(f"Moodle 時間軸 API 回傳錯誤：{data}")

    items: list[dict[str, object]] = []
    for event in data[0]["data"]["events"]:
        action = event.get("action") or {}
        course = event.get("course") or {}
        items.append(
            {
                "dateGroup": datetime.fromtimestamp(event["timesort"], TAIPEI).strftime("%Y-%m-%d"),
                "time": datetime.fromtimestamp(event["timesort"], TAIPEI).strftime("%H:%M"),
                "title": normalize(str(event.get("activityname") or event.get("name") or "")),
                "summary": normalize(str(event.get("activitystr") or "")),
                "eventUrl": normalize(str(event.get("viewurl") or "")),
                "actionLabel": normalize(str(action.get("name") or "")),
                "actionUrl": normalize(str(action.get("url") or "")),
                "iconAlt": normalize(str((event.get("icon") or {}).get("alttext") or "")),
                "ariaLabel": normalize(str(event.get("name") or "")),
                "courseName": normalize(str(course.get("fullnamedisplay") or course.get("fullname") or "")),
                "moduleName": normalize(str(event.get("modulename") or "")),
                "eventType": normalize(str(event.get("eventtype") or "")),
                "timesort": event.get("timesort"),
                "overdue": event.get("overdue", False),
            }
        )

    return items


def main() -> None:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        }
    )

    page_response = login(session)
    soup = BeautifulSoup(page_response.text, "html.parser")
    timeline_config, _ = extract_timeline_items(soup)
    timeline_items = fetch_timeline_items(session, page_response.text, timeline_config)
    assignments = [
        item
        for item in timeline_items
        if item["actionLabel"] == "繳交作業" or "/mod/assign/" in str(item["eventUrl"])
    ]

    (OUTPUT_DIR / "moodle-dashboard.html").write_text(page_response.text, encoding="utf-8")
    (OUTPUT_DIR / "flow-log.md").write_text(render_flow_markdown(flow), encoding="utf-8")
    write_json("timeline-items.json", timeline_items)
    write_csv(
        "timeline-items.csv",
        [
            "dateGroup",
            "time",
            "title",
            "summary",
            "courseName",
            "moduleName",
            "eventType",
            "eventUrl",
            "actionLabel",
            "actionUrl",
            "iconAlt",
            "ariaLabel",
            "timesort",
            "overdue",
        ],
        timeline_items,
    )
    write_csv(
        "timeline-assignments.csv",
        [
            "dateGroup",
            "time",
            "title",
            "summary",
            "courseName",
            "moduleName",
            "eventType",
            "eventUrl",
            "actionLabel",
            "actionUrl",
            "iconAlt",
            "ariaLabel",
            "timesort",
            "overdue",
        ],
        assignments,
    )
    write_json(
        "run-summary.json",
        {
            "generatedAt": now(),
            "url": page_response.url,
            "title": normalize(soup.title.get_text(" ", strip=True) if soup.title else ""),
            "timelineFilter": timeline_config["filterLabel"],
            "timelineItemCount": len(timeline_items),
            "assignmentCount": len(assignments),
        },
    )

    print(
        json.dumps(
            {
                    "outputDir": str(OUTPUT_DIR),
                    "timelineFilter": timeline_config["filterLabel"],
                    "timelineItemCount": len(timeline_items),
                    "assignmentCount": len(assignments),
                },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
