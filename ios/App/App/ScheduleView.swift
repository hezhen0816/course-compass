import SwiftUI

struct ScheduleView: View {
    @EnvironmentObject private var store: AppSessionStore

    @State private var selectedCourseDetail: CourseDetailSelection?

    private var visibleWeekdays: [Weekday] {
        let weekdaysWithCourses = Set(store.scheduleEntries.map(\.weekday))
        return Weekday.allCases.filter { weekday in
            weekday.isRegularSchoolDay || weekdaysWithCourses.contains(weekday)
        }
    }

    private var visiblePeriods: [ClassPeriod] {
        let occupiedPeriodIDs = Set(scheduleCells.keys.map(\.periodID))
        let basePeriods = ClassPeriod.allCases.filter { period in
            period.isDaytime || occupiedPeriodIDs.contains(period.id)
        }
        return basePeriods.isEmpty ? ClassPeriod.daytimePeriods : basePeriods
    }

    private var scheduleCells: [ScheduleGridKey: [ScheduleEntry]] {
        Dictionary(grouping: expandedScheduleCells, by: \.key).mapValues { cells in
            cells.map(\.entry)
        }
    }

    private var expandedScheduleCells: [ExpandedScheduleCell] {
        store.scheduleEntries.flatMap { entry in
            let periodIDs = ClassPeriod.periodIDs(for: entry)
            return periodIDs.map { periodID in
                ExpandedScheduleCell(
                    key: ScheduleGridKey(weekday: entry.weekday, periodID: periodID),
                    entry: entry
                )
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                ScreenHeader(eyebrow: syncEyebrow, title: "課表")

                if case .failed(let message) = store.syncState {
                    Callout(text: message, tone: .danger, systemImage: "exclamationmark.triangle.fill")
                }

                if store.scheduleEntries.isEmpty {
                    EmptyNote(
                        title: "尚未有課表資料",
                        message: "到設定同步課表後，這裡會顯示每週課程與空堂。",
                        systemImage: "calendar.badge.exclamationmark"
                    )
                } else {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        WeekBoard(
                            weekdays: visibleWeekdays,
                            periods: visiblePeriods,
                            cells: scheduleCells,
                            today: Weekday.currentWeekday(from: context.date),
                            currentPeriodID: ClassPeriod.currentPeriodID(at: context.date),
                            onSelectEntries: { entries in
                                selectedCourseDetail = CourseDetailSelection(entries: entries)
                            }
                        )
                    }

                    Text("點一下課程查看教室、教師與課堂筆記。")
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.top, Theme.Space.s)
            .padding(.bottom, Theme.Space.xxl)
        }
        .refreshable {
            await refreshSchedule()
        }
        .screenChrome()
        .sheet(item: $selectedCourseDetail) { detail in
            ScheduleCourseDetailSheet(entries: detail.entries)
                .environmentObject(store)
        }
    }

    private var syncEyebrow: String? {
        guard let lastSyncedAt = store.lastSyncedAt else {
            return nil
        }
        return "上次同步 \(TWDate.string(lastSyncedAt, "M/d HH:mm"))"
    }

    private func refreshSchedule() async {
        await store.refreshAppContent(suppressErrors: false)
    }
}

// MARK: - Week board

/// A run of consecutive periods on one weekday that share the same entries (or are all empty).
private struct DaySegment: Identifiable {
    let id: String
    let periods: [ClassPeriod]
    let entries: [ScheduleEntry]
}

/// Weekly grid drawn like a printed timetable: one shared vertical scroll (no nested
/// ScrollView), a period rail on the left, and consecutive periods of the same course
/// merged into one block so a two-hour class reads as one thing.
private struct WeekBoard: View {
    let weekdays: [Weekday]
    let periods: [ClassPeriod]
    let cells: [ScheduleGridKey: [ScheduleEntry]]
    let today: Weekday
    let currentPeriodID: String?

    /// Weekends without classes have no column, so the rail must not mark a period as "now" then.
    private var isTodayShown: Bool { weekdays.contains(today) }
    let onSelectEntries: ([ScheduleEntry]) -> Void

    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 58
    @ScaledMetric(relativeTo: .caption2) private var scaledRailWidth: CGFloat = 38
    /// Capped so large Dynamic Type grows the rows, not the rail, keeping weekday columns usable.
    private var railWidth: CGFloat { min(scaledRailWidth, 46) }
    private let gap: CGFloat = 3

    var body: some View {
        VStack(spacing: 0) {
            headerRow
            Rectangle()
                .fill(Theme.ink)
                .frame(height: 2)
                .accessibilityHidden(true)

            HStack(alignment: .top, spacing: gap) {
                VStack(spacing: gap) {
                    ForEach(periods) { period in
                        PeriodRailCell(period: period, isCurrent: isTodayShown && period.id == currentPeriodID)
                            .frame(width: railWidth, height: rowHeight)
                    }
                }

                ForEach(weekdays) { weekday in
                    dayColumn(for: weekday)
                }
            }
            .padding(.top, gap)
            .background(alignment: .top) {
                rowRules
                    .padding(.top, gap)
            }
        }
    }

    private var headerRow: some View {
        HStack(spacing: gap) {
            Text("節")
                .font(.caption.weight(.bold))
                .foregroundStyle(Theme.inkSecondary)
                .frame(width: railWidth)
                .accessibilityHidden(true)

            ForEach(weekdays) { weekday in
                let isToday = weekday == today
                Text(weekday.shortTitle)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(isToday ? Theme.onInk : Theme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(
                        UnevenRoundedRectangle(
                            topLeadingRadius: Theme.Radius.tag,
                            topTrailingRadius: Theme.Radius.tag,
                            style: .continuous
                        )
                        .fill(isToday ? Theme.ink : Color.clear)
                    )
                    .accessibilityLabel(isToday ? "\(weekday.fullTitle)，今天" : weekday.fullTitle)
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// Hairlines under every period row, drawn behind the columns.
    private var rowRules: some View {
        VStack(spacing: gap) {
            ForEach(periods) { _ in
                Color.clear
                    .frame(height: rowHeight)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(Theme.rule)
                            .frame(height: 1)
                            .offset(y: (gap + 1) / 2)
                    }
            }
        }
        .accessibilityHidden(true)
    }

    private func dayColumn(for weekday: Weekday) -> some View {
        let isToday = weekday == today
        return VStack(spacing: gap) {
            ForEach(segments(for: weekday)) { segment in
                let span = CGFloat(segment.periods.count)
                let height = span * rowHeight + (span - 1) * gap
                let isNow = isToday && segment.periods.contains { $0.id == currentPeriodID }

                Group {
                    if segment.entries.isEmpty {
                        EmptySlot(isNow: isNow)
                    } else {
                        CourseBlock(
                            weekday: weekday,
                            periods: segment.periods,
                            entries: segment.entries,
                            isNow: isNow,
                            onSelect: onSelectEntries
                        )
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: height)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                .fill(isToday ? Theme.sunken.opacity(0.7) : Color.clear)
                .padding(.top, -gap)
        )
    }

    private func segments(for weekday: Weekday) -> [DaySegment] {
        var result: [DaySegment] = []
        var runPeriods: [ClassPeriod] = []
        var runEntries: [ScheduleEntry] = []

        func flush() {
            guard let first = runPeriods.first else { return }
            result.append(DaySegment(id: "\(weekday.rawValue)-\(first.id)", periods: runPeriods, entries: runEntries))
            runPeriods = []
            runEntries = []
        }

        for period in periods {
            let entries = cells[ScheduleGridKey(weekday: weekday, periodID: period.id)] ?? []
            let sameAsRun = !runPeriods.isEmpty
                && !entries.isEmpty
                && entries.map(\.id) == runEntries.map(\.id)
            if sameAsRun {
                runPeriods.append(period)
            } else {
                flush()
                runPeriods = [period]
                runEntries = entries
            }
        }
        flush()
        return result
    }
}

private struct PeriodRailCell: View {
    let period: ClassPeriod
    let isCurrent: Bool

    var body: some View {
        VStack(spacing: 1) {
            Text(period.id)
                .font(.system(.subheadline, design: .monospaced).weight(.heavy))
                .foregroundStyle(isCurrent ? Theme.signal : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(period.startText)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.inkSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if isCurrent {
                Text("現在")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(Theme.signal)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("第 \(period.id) 節，\(period.startText) 到 \(period.endText)\(isCurrent ? "，現在" : "")")
    }
}

private struct EmptySlot: View {
    let isNow: Bool

    var body: some View {
        ZStack {
            if isNow {
                RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                    .strokeBorder(Theme.signal, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                Text("空堂")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(Theme.signal)
            }
        }
        .accessibilityHidden(!isNow)
        .accessibilityLabel("現在空堂")
    }
}

private struct CourseBlock: View {
    let weekday: Weekday
    let periods: [ClassPeriod]
    let entries: [ScheduleEntry]
    let isNow: Bool
    let onSelect: ([ScheduleEntry]) -> Void

    private var primary: ScheduleEntry { entries[0] }
    private var hue: Color { primary.accent.themeColor }

    var body: some View {
        Button {
            onSelect(entries)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(primary.title)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .minimumScaleFactor(0.8)
                    .layoutPriority(1)

                if !primary.room.isEmpty {
                    Text(primary.room)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.inkSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }

                Spacer(minLength: 0)

                if entries.count > 1 {
                    Text("+\(entries.count - 1)")
                        .font(.caption2.weight(.heavy))
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .padding(.leading, 6)
            .padding(.trailing, 3)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                ZStack {
                    Theme.surface
                    hue.opacity(0.16)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous))
            .overlay {
                if isNow {
                    RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                        .strokeBorder(Theme.signal, lineWidth: 2)
                }
            }
            .overlay(alignment: .topTrailing) {
                if isNow {
                    LiveDot()
                        .padding(3)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("顯示課程詳情")
    }

    private var accessibilityText: String {
        let range = periods.count > 1 ? "第 \(periods[0].id) 到 \(periods[periods.count - 1].id) 節" : "第 \(periods[0].id) 節"
        var parts = ["\(weekday.fullTitle) \(range)", primary.title]
        if !primary.room.isEmpty {
            parts.append("教室 \(primary.room)")
        }
        if entries.count > 1 {
            parts.append("另有 \(entries.count - 1) 門課")
        }
        if isNow {
            parts.append("正在進行")
        }
        return parts.joined(separator: "，")
    }
}

// MARK: - Detail sheet

private struct CourseDetailSelection: Identifiable {
    let id = UUID()
    let entries: [ScheduleEntry]
}

private struct ScheduleCourseDetailSheet: View {
    @EnvironmentObject private var store: AppSessionStore
    @Environment(\.dismiss) private var dismiss
    let entries: [ScheduleEntry]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: Theme.Space.m) {
                            CourseDetailCard(entry: entry)
                            // 課表是進入課堂筆記與成績試算最自然的入口：上課當下就在看課表
                            if let context = store.plannerCourseContext(forTitle: entry.title) {
                                NavigationLink {
                                    CourseNoteEditor(semesterID: context.semesterID, course: context.course)
                                        .environmentObject(store)
                                } label: {
                                    Label("課堂筆記與成績試算", systemImage: "square.and.pencil")
                                }
                                .buttonStyle(PrimaryButtonStyle())
                            }
                        }
                    }
                }
                .padding(Theme.Space.gutter)
            }
            .background(Theme.canvas.ignoresSafeArea())
            .navigationTitle(entries.count > 1 ? "課程詳情" : entries[0].title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
        .tint(Theme.signal)
    }
}

private struct CourseDetailCard: View {
    let entry: ScheduleEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(entry.accent.themeColor)
                .frame(height: 4)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Space.m) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(entry.accent.title)
                        .font(Theme.Typeface.eyebrow)
                        .foregroundStyle(Theme.inkSecondary)
                    Text(entry.title)
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 0) {
                    detailRow(title: "星期", value: entry.weekday.fullTitle)
                    detailRow(title: "時間", value: entry.timeRange, mono: true)
                    if !entry.slotTimes.isEmpty {
                        detailRow(title: "節次時間", value: entry.slotTimes.joined(separator: "\n"), mono: true)
                    }
                    detailRow(title: "教室", value: entry.room.isEmpty ? "未提供" : entry.room, mono: !entry.room.isEmpty)
                    detailRow(title: "教師", value: entry.instructor.isEmpty ? "未提供" : entry.instructor, isLast: true)
                }
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
    }

    private func detailRow(title: String, value: String, mono: Bool = false, isLast: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                    label(title)
                        .frame(width: 64, alignment: .leading)
                    valueText(value, mono: mono)
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: 2) {
                    label(title)
                    valueText(value, mono: mono)
                }
            }
            .padding(.vertical, Theme.Space.s)
            if !isLast {
                RuleLine()
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.inkSecondary)
    }

    private func valueText(_ text: String, mono: Bool) -> some View {
        Text(text)
            .font(mono ? Theme.Typeface.code : .subheadline.weight(.semibold))
            .foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ExpandedScheduleCell {
    let key: ScheduleGridKey
    let entry: ScheduleEntry
}

private struct ScheduleGridKey: Hashable {
    let weekday: Weekday
    let periodID: String
}

private struct ClassPeriod: Identifiable, Hashable {
    let id: String
    let startHour: Int
    let startMinute: Int
    let endHour: Int
    let endMinute: Int

    var isDaytime: Bool {
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].contains(id)
    }

    var startText: String {
        Self.timeText(hour: startHour, minute: startMinute)
    }

    var endText: String {
        Self.timeText(hour: endHour, minute: endMinute)
    }

    static let allCases: [ClassPeriod] = [
        ClassPeriod(id: "1", startHour: 8, startMinute: 10, endHour: 9, endMinute: 0),
        ClassPeriod(id: "2", startHour: 9, startMinute: 10, endHour: 10, endMinute: 0),
        ClassPeriod(id: "3", startHour: 10, startMinute: 20, endHour: 11, endMinute: 10),
        ClassPeriod(id: "4", startHour: 11, startMinute: 20, endHour: 12, endMinute: 10),
        ClassPeriod(id: "5", startHour: 12, startMinute: 20, endHour: 13, endMinute: 10),
        ClassPeriod(id: "6", startHour: 13, startMinute: 20, endHour: 14, endMinute: 10),
        ClassPeriod(id: "7", startHour: 14, startMinute: 20, endHour: 15, endMinute: 10),
        ClassPeriod(id: "8", startHour: 15, startMinute: 30, endHour: 16, endMinute: 20),
        ClassPeriod(id: "9", startHour: 16, startMinute: 30, endHour: 17, endMinute: 20),
        ClassPeriod(id: "10", startHour: 17, startMinute: 30, endHour: 18, endMinute: 20),
        ClassPeriod(id: "A", startHour: 18, startMinute: 25, endHour: 19, endMinute: 15),
        ClassPeriod(id: "B", startHour: 19, startMinute: 20, endHour: 20, endMinute: 10),
        ClassPeriod(id: "C", startHour: 20, startMinute: 15, endHour: 21, endMinute: 5),
        ClassPeriod(id: "D", startHour: 21, startMinute: 10, endHour: 22, endMinute: 0)
    ]

    static var daytimePeriods: [ClassPeriod] {
        allCases.filter(\.isDaytime)
    }

    static func currentPeriodID(at date: Date, calendar: Calendar = .current) -> String? {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else {
            return nil
        }

        let currentMinutes = hour * 60 + minute
        return allCases.first { period in
            let startMinutes = period.startHour * 60 + period.startMinute
            let endMinutes = period.endHour * 60 + period.endMinute
            return startMinutes <= currentMinutes && currentMinutes <= endMinutes
        }?.id
    }

    static func periodIDs(for entry: ScheduleEntry) -> [String] {
        let labels = entry.slotTimes.isEmpty ? [entry.timeRange] : entry.slotTimes
        let matched = labels.compactMap { label -> String? in
            guard let start = parseStartTime(from: label) else {
                return nil
            }
            return allCases.first { period in
                period.startHour == start.hour && period.startMinute == start.minute
            }?.id
        }

        if !matched.isEmpty {
            var seen = Set<String>()
            return matched.filter { seen.insert($0).inserted }
        }

        return periodIDsCovering(timeRange: entry.timeRange)
    }

    private static func periodIDsCovering(timeRange: String) -> [String] {
        guard
            let start = parseStartTime(from: timeRange),
            let end = parseEndTime(from: timeRange)
        else {
            return []
        }

        let startMinutes = start.hour * 60 + start.minute
        let endMinutes = end.hour * 60 + end.minute
        return allCases.compactMap { period in
            let periodStart = period.startHour * 60 + period.startMinute
            let periodEnd = period.endHour * 60 + period.endMinute
            return periodStart >= startMinutes && periodEnd <= endMinutes ? period.id : nil
        }
    }

    private static func parseStartTime(from label: String) -> (hour: Int, minute: Int)? {
        parseTimes(from: label).first
    }

    private static func parseEndTime(from label: String) -> (hour: Int, minute: Int)? {
        parseTimes(from: label).dropFirst().first
    }

    private static func parseTimes(from label: String) -> [(hour: Int, minute: Int)] {
        label.matches(of: /(\d{1,2}):(\d{2})/).compactMap { match in
            guard
                let hour = Int(match.output.1),
                let minute = Int(match.output.2)
            else {
                return nil
            }
            return (hour, minute)
        }
    }

    private static func timeText(hour: Int, minute: Int) -> String {
        "\(hour):\(String(format: "%02d", minute))"
    }
}

private extension Weekday {
    var isRegularSchoolDay: Bool {
        switch self {
        case .monday, .tuesday, .wednesday, .thursday, .friday:
            return true
        case .saturday, .sunday:
            return false
        }
    }
}


/// 課堂筆記與成績試算。手機端只編輯這些「上課當下會記」的欄位；
/// 學分、類別、認列歸屬等規劃性設定留在網頁版，避免手機再長出一套殘缺的編輯器。
/// 課表與學分規劃兩個入口共用同一支，不再各有一套。
struct CourseNoteEditor: View {
    @EnvironmentObject private var store: AppSessionStore
    @Environment(\.dismiss) private var dismiss

    let semesterID: PlannerSemester.ID
    @State var course: PlannerCourse

    var body: some View {
        Form {
            Section("課堂資訊") {
                LabeledContent("課程") { Text(course.name).foregroundStyle(.secondary) }
                if !course.courseNo.isEmpty {
                    LabeledContent("課碼") { Text(course.courseNo).monospaced().foregroundStyle(.secondary) }
                }
                LabeledContent("學分") { Text("\(course.credits, specifier: "%.0f")").foregroundStyle(.secondary) }
                LabeledContent("類別") { Text(course.category.title).foregroundStyle(.secondary) }
                TextField("授課教授", text: $course.instructor)
                TextField("教授 Email", text: $course.email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("上課地點", text: $course.location)
                TextField("上課時間", text: $course.time)
                TextField("課程連結", text: $course.link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
            }
            .listRowBackground(Theme.surface)

            Section("備註") {
                TextField("第一堂課的重點、評分方式、作業規定…", text: $course.notes, axis: .vertical)
                    .lineLimit(3...10)
            }
            .listRowBackground(Theme.surface)

            Section {
                ForEach($course.gradingPolicy) { $item in
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("項目名稱（例如 期中考）", text: $item.name)
                        HStack {
                            LabeledContent("權重") {
                                TextField("0", value: $item.weight, format: .number)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                            }
                            Text("%").foregroundStyle(.secondary)
                        }
                        LabeledContent("分數") {
                            TextField("未輸入", value: $item.score, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .onDelete { offsets in
                    course.gradingPolicy.remove(atOffsets: offsets)
                }

                Button {
                    course.gradingPolicy.append(PlannerGradingItem())
                } label: {
                    Label("新增評分項目", systemImage: "plus.circle")
                }
            } header: {
                Text("成績試算")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("目前總分 \(course.projectedScore, format: .number.precision(.fractionLength(1))) 分（依已填分數的權重換算）")
                    Text(weightFooter)
                        .foregroundStyle(course.totalWeight == 100 ? Theme.inkSecondary : Theme.busy)
                }
                .foregroundStyle(Theme.inkSecondary)
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.canvas.ignoresSafeArea())
        .tint(Theme.signal)
        .navigationTitle("課堂筆記")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("儲存") {
                    store.updateCourse(course, in: semesterID)
                    dismiss()
                }
            }
        }
    }

    private var weightFooter: String {
        let total = course.totalWeight
        if total == 100 { return "總權重 100%" }
        return "總權重 \(total.formatted(.number.precision(.fractionLength(0))))%（未達 100%，試算僅依已填項目換算）"
    }
}
