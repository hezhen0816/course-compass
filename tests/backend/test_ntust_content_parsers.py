from __future__ import annotations

from backend.integrations import history, moodle


def test_moodle_assignment_filter_keeps_actionable_items_and_sorts() -> None:
    items = [
        {
            "due_at": "2026-04-15T10:00:00+08:00",
            "title": "閱讀公告",
            "course_name": "A",
            "action_label": "",
            "action_url": "",
            "event_url": "/mod/forum/view.php",
            "module_name": "forum",
            "event_type": "due",
        },
        {
            "due_at": "2026-04-14T10:00:00+08:00",
            "title": "小考",
            "course_name": "B",
            "action_label": "",
            "action_url": "/mod/quiz/view.php",
            "event_url": "",
            "module_name": "quiz",
            "event_type": "due",
        },
        {
            "due_at": "2026-04-13T10:00:00+08:00",
            "title": "作業一",
            "course_name": "A",
            "action_label": "繳交作業",
            "action_url": "/mod/assign/view.php",
            "event_url": "",
            "module_name": "assign",
            "event_type": "due",
        },
    ]

    filtered = moodle.filter_moodle_assignment_items(items)

    assert [item["title"] for item in filtered] == ["作業一", "小考"]


def test_history_parser_reads_edu_need_course_table() -> None:
    soup = history.BeautifulSoup(
        """
        <table>
          <tr><td class="TD_title1_C">其他選修</td></tr>
          <tr><td>
            <table>
              <tr><td>課程代碼</td><td>課程名稱</td><td>學年期</td><td>成績</td><td>實得學分</td></tr>
              <tr><td>CC101A</td><td>英文字彙與閱讀(上)</td><td>1141</td><td>B+</td><td>2</td></tr>
              <tr><td>CC101B</td><td>英文字彙與閱讀(下)</td><td>1142</td><td>修習中</td><td>2</td></tr>
            </table>
          </td></tr>
        </table>
        """,
        "html.parser",
    )

    rows = history.extract_history_course_tables(soup)

    assert rows == [
        {
            "category": "其他選修",
            "course_code": "CC101A",
            "course_name": "英文字彙與閱讀(上)",
            "academic_term": "1141",
            "grade": "B+",
            "earned_credits": "2",
            "ge_dimension": "",
        },
        {
            "category": "其他選修",
            "course_code": "CC101B",
            "course_name": "英文字彙與閱讀(下)",
            "academic_term": "1142",
            "grade": "修習中",
            "earned_credits": "2",
            "ge_dimension": "",
        },
    ]


def test_history_parser_reads_score_display_all_course_table() -> None:
    soup = history.BeautifulSoup(
        """
        <div class="box">
          <div class="box-header"><h2>歷年學業成績列表</h2></div>
          <div class="box-content">
            <table>
              <tr>
                <th>序</th><th>學年期</th><th>課程代碼</th><th>課程名稱</th><th>學分數</th>
                <th>成績</th><th>備註說明</th><th>通識向度</th><th>遠距教學課程</th>
              </tr>
              <tr>
                <td>1</td><td>1142</td><td>CC101B033</td><td>英文字彙與閱讀(下)</td><td>2</td>
                <td>成績未到</td><td>成績未到</td><td></td><td></td>
              </tr>
              <tr>
                <td>13</td><td>1141</td><td>CS1003301</td><td>計算機程式設計</td><td>3</td>
                <td>B</td><td></td><td></td><td></td>
              </tr>
              <tr>
                <td>14</td><td>1142</td><td>GE3731301</td><td>科技與法律</td><td>2</td>
                <td>成績未到</td><td>成績未到</td><td>B</td><td></td>
              </tr>
            </table>
          </div>
        </div>
        """,
        "html.parser",
    )

    rows = history.extract_history_course_tables(soup)

    assert rows[0] == {
        "category": "歷年學業成績",
        "course_code": "CC101B033",
        "course_name": "英文字彙與閱讀(下)",
        "academic_term": "1142",
        "grade": "成績未到",
        "earned_credits": "2",
        "ge_dimension": "",
    }
    assert rows[1]["course_code"] == "CS1003301"
    assert rows[2]["category"] == "通識向度 B"
    assert rows[2]["ge_dimension"] == "B"
