import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppSessionStore

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    ScreenHeader(eyebrow: TWDate.string(context.date, "M 月 d 日 EEEE"), title: "今天")
                    NowBoard(course: store.nextUpcomingCourse, now: context.date)
                    todaySection(now: context.date)
                    assignmentsSection
                    creditsSection
                }
                .screenPadding()
            }
            .refreshable {
                await store.refreshHomeContent()
            }
        }
        .screenChrome()
    }

    // MARK: Today

    private func todaySection(now: Date) -> some View {
        let courses = store.todayUpcomingCourses

        return VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("今日課程", caption: "只顯示今天尚未結束的課程與提醒") {
                if !courses.isEmpty {
                    Text("\(courses.count) 堂")
                        .font(Theme.Typeface.count)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }

            if courses.isEmpty {
                EmptyNote(
                    title: "今天沒有剩餘課程",
                    message: "今天已經結束的課不會再顯示，也不會顯示其他日期的課程。",
                    systemImage: "sun.max"
                )
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(courses.enumerated()), id: \.element.id) { index, course in
                        TimelineRow(course: course, now: now, isLast: index == courses.count - 1)
                    }
                }
            }
        }
    }

    // MARK: Assignments

    private var assignmentsSection: some View {
        let items = store.moodleAssignments

        return VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("待繳事項", caption: assignmentsCaption) {
                if !items.isEmpty {
                    Text("\(items.count) 項")
                        .font(Theme.Typeface.count)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }

            if items.isEmpty {
                EmptyNote(
                    title: "目前沒有待繳事項",
                    message: "同步 Moodle 後，這裡會顯示近期需要繳交的作業。",
                    systemImage: "checkmark.seal"
                )
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(items.prefix(4)) { item in
                        AssignmentRow(item: item)
                        RuleLine()
                    }
                }
                if items.count > 4 {
                    Text("另有 \(items.count - 4) 項未列出")
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
        }
    }

    private var assignmentsCaption: String {
        if let syncedAt = store.moodleAssignmentsSyncedAt {
            let filterLabel = Self.nonEmpty(store.moodleAssignmentsFilterLabel) ?? "往後30天"
            return "\(filterLabel)・上次更新 \(TWDate.string(syncedAt, "M/d HH:mm"))"
        }
        return "同步 Moodle 後，會顯示往後30天需要繳交的作業"
    }

    // MARK: Credits

    private var creditsSection: some View {
        let progress = store.plannerProgress
        let targets = store.plannerTargets

        return VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("學分摘要", caption: "快速查看目前進度與剩餘目標") {
                Button {
                    store.selectedTab = .planner
                } label: {
                    HStack(spacing: 2) {
                        Text("完整規劃")
                        Image(systemName: "arrow.right")
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.signal)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("開啟學分規劃")
            }

            VStack(alignment: .leading, spacing: Theme.Space.l) {
                RequirementRow(title: "總學分", current: progress.total, target: targets.total)
                RequirementRow(title: "通識", current: progress.genEd, target: targets.genEd)
                RequirementRow(title: "共同英文", current: progress.english, target: targets.english)
                RequirementRow(title: "本系必修", current: progress.homeCompulsory, target: targets.homeCompulsory)
                GenEdStrip(completed: Array(progress.genEdDimensions))
            }
            .panel()
        }
    }

    static func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Countdown model

/// Splits a course's countdown into a big number, a unit line and a full sentence.
private struct Countdown {
    enum Phase {
        case before
        case inClass
        case between
    }

    let phase: Phase
    let minutes: Int

    init?(course: UpcomingCourse, now: Date) {
        guard let state = course.countdownState(on: now) else {
            return nil
        }
        switch state {
        case .beforeClass(let start):
            phase = .before
            minutes = max(1, Int(start.timeIntervalSince(now) / 60))
        case .inClass(let end):
            phase = .inClass
            minutes = max(1, Int(end.timeIntervalSince(now) / 60))
        case .betweenSessions(let next):
            phase = .between
            minutes = max(1, Int(next.timeIntervalSince(now) / 60))
        }
    }

    var statusLabel: String {
        switch phase {
        case .before:
            return "下一堂"
        case .inClass:
            return "上課中"
        case .between:
            return "下課中"
        }
    }

    /// "23" or "1:35".
    var figure: String {
        minutes < 60 ? "\(minutes)" : "\(minutes / 60):\(String(format: "%02d", minutes % 60))"
    }

    var unitLine: String {
        let unit = minutes < 60 ? "分鐘" : "小時"
        switch phase {
        case .before:
            return "\(unit)後上課"
        case .inClass:
            return "\(unit)後下課"
        case .between:
            return "\(unit)後下節上課"
        }
    }

    /// Same wording as the original countdown text, for VoiceOver and the timeline rows.
    var sentence: String {
        switch phase {
        case .before:
            return "距離上課還有 \(minutes) 分鐘"
        case .inClass:
            return "正在上課中，距離下課還有 \(minutes) 分鐘"
        case .between:
            return "下課中，距離下節上課還有 \(minutes) 分鐘"
        }
    }
}

// MARK: - Now board

private struct NowBoard: View {
    let course: UpcomingCourse?
    let now: Date

    @ScaledMetric(relativeTo: .largeTitle) private var figureSize: CGFloat = 64

    var body: some View {
        if let course {
            let countdown = Countdown(course: course, now: now)
            let isLive = countdown?.phase == .inClass

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: Theme.Space.s) {
                    if isLive {
                        LiveDot(color: Theme.onFill)
                    }
                    Text(countdown?.statusLabel ?? "下一堂課")
                        .font(.footnote.weight(.heavy))
                    Spacer(minLength: Theme.Space.s)
                    Text(course.timeLabel)
                        .font(Theme.Typeface.codeSmall)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .foregroundStyle(isLive ? Theme.onFill : Theme.onInk)
                .padding(.horizontal, Theme.Space.l)
                .padding(.vertical, Theme.Space.s)
                .background(isLive ? Theme.signal : Theme.ink)

                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    if let countdown {
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                            Text(countdown.figure)
                                .font(.system(size: figureSize, weight: .heavy))
                                .fontWidth(.compressed)
                                .monospacedDigit()
                                .foregroundStyle(isLive ? Theme.signal : Theme.ink)
                                .contentTransition(.numericText(countsDown: true))
                                .animation(.snappy, value: countdown.minutes)
                            Text(countdown.unitLine)
                                .font(.headline)
                                .foregroundStyle(Theme.inkSecondary)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(countdown.sentence)
                    }

                    Text(course.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    RoomPlate(room: course.room)
                }
                .padding(Theme.Space.l)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .fill(Theme.surface)
                    .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
            .overlay {
                if isLive {
                    RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                        .strokeBorder(Theme.signal, lineWidth: 2)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                Text("今天的課都結束了")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.ink)
                Text("今天沒有剩餘課程，可以保留時間安排複習或作業。")
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .panel()
        }
    }
}

/// Room code on a soft sunken plate.
private struct RoomPlate: View {
    let room: String

    var body: some View {
        let trimmed = room.trimmingCharacters(in: .whitespacesAndNewlines)
        HStack(spacing: 6) {
            Image(systemName: "mappin")
                .font(.footnote.weight(.bold))
                .accessibilityHidden(true)
            Text(trimmed.isEmpty ? "教室未提供" : trimmed)
                .font(Theme.Typeface.code)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, Theme.Space.s)
        .padding(.vertical, 6)
        .background(Theme.sunken, in: RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("教室 \(trimmed.isEmpty ? "未提供" : trimmed)")
    }
}

// MARK: - Timeline row

private struct TimelineRow: View {
    let course: UpcomingCourse
    let now: Date
    let isLast: Bool

    @ScaledMetric(relativeTo: .headline) private var timeColumnWidth: CGFloat = 52

    private var countdown: Countdown? {
        Countdown(course: course, now: now)
    }

    private var isLive: Bool {
        countdown?.phase == .inClass
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(Self.clock(course.startTime))
                    .font(.system(.headline, design: .monospaced).weight(.bold))
                    .foregroundStyle(Theme.ink)
                Text(Self.clock(course.endTime))
                    .font(Theme.Typeface.codeSmall)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .frame(minWidth: timeColumnWidth, alignment: .trailing)

            VStack(spacing: 0) {
                Circle()
                    .fill(isLive ? Theme.signal : Theme.canvas)
                    .overlay(Circle().strokeBorder(isLive ? Theme.signal : Theme.inkTertiary, lineWidth: 2))
                    .frame(width: 12, height: 12)
                    .padding(.top, 5)
                Rectangle()
                    .fill(isLast ? Color.clear : Theme.rule)
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text(course.title)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if !course.subtitle.isEmpty {
                    Text(course.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let countdown {
                    HStack(spacing: 6) {
                        if isLive {
                            LiveDot()
                        }
                        Text(countdown.sentence)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(isLive ? Theme.signal : Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Theme.Space.m) {
                        roomText
                        noteText
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        roomText
                        noteText
                    }
                }
            }
            .padding(.bottom, isLast ? 0 : Theme.Space.l)

            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var roomText: some View {
        if !course.room.isEmpty {
            Label(course.room, systemImage: "mappin")
                .font(Theme.Typeface.codeSmall)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private var noteText: some View {
        if !course.note.isEmpty {
            Label(course.note, systemImage: "bell")
                .font(.caption)
                .foregroundStyle(Theme.inkSecondary)
                .lineLimit(1)
        }
    }

    static func clock(_ components: DateComponents) -> String {
        String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }
}

// MARK: - Assignment row

private struct AssignmentRow: View {
    let item: MoodleAssignmentItem

    @ScaledMetric(relativeTo: .title3) private var dateColumnWidth: CGFloat = 60

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: 0) {
                Text(TWDate.string(item.dueAt, "M/d"))
                    .font(.system(.title3, design: .monospaced).weight(.heavy))
                    .foregroundStyle(item.overdue ? Theme.danger : Theme.ink)
                Text(TWDate.string(item.dueAt, "HH:mm"))
                    .font(Theme.Typeface.codeSmall)
                    .foregroundStyle(Theme.ink)
                Text(TWDate.string(item.dueAt, "EEEE"))
                    .font(.caption2)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .frame(minWidth: dateColumnWidth, alignment: .leading)

            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Tag(
                    text: item.overdue ? "已逾期" : HomeView.nonEmpty(item.actionLabel) ?? "待處理",
                    tone: item.overdue ? .danger : .signal,
                    filled: item.overdue
                )
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.courseName)
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !item.summary.isEmpty {
                    Text(item.summary)
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Theme.Space.m)
        .accessibilityElement(children: .combine)
    }
}
