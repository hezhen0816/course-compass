import SwiftUI

struct PlannerView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var expandedSemesters: Set<UUID> = []
    @State private var selectedCourseContext: PlannerCourseContext?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                ScreenHeader(eyebrow: plannedCreditsEyebrow, title: "學分規劃")

                Callout(
                    text: "新增課程與畢業門檻請在網頁版調整；手機專注在課表、課堂筆記與成績試算。",
                    tone: .neutral,
                    systemImage: "info.circle"
                )

                requirementsSection
                semestersSection
            }
            .screenPadding()
        }
        .screenChrome()
        .sheet(item: $selectedCourseContext) { context in
            NavigationStack {
                CourseNoteEditor(semesterID: context.semesterID, course: context.course)
                    .environmentObject(store)
            }
        }
        .onAppear {
            if expandedSemesters.isEmpty, let firstSemester = store.plannerSemesters.first?.id {
                expandedSemesters.insert(firstSemester)
            }
        }
    }

    private var plannedCreditsEyebrow: String {
        let total = store.plannerSemesters.reduce(0) { $0 + store.credits(for: $1) }
        return "八學期・已排入 \(Int(total)) 學分"
    }

    // MARK: Requirements

    private var requirementsSection: some View {
        let progress = store.plannerProgress
        let targets = store.plannerTargets

        return VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("進度摘要", caption: "已修／目標，達成的項目會標上勾號")

            VStack(alignment: .leading, spacing: Theme.Space.l) {
                RequirementRow(title: "總學分", current: progress.total, target: targets.total)
                RequirementRow(title: "國文", current: progress.chinese, target: targets.chinese)
                RequirementRow(title: "英文", current: progress.english, target: targets.english)
                RequirementRow(title: "通識", current: progress.genEd, target: targets.genEd)
                RequirementRow(title: "體育學期數", current: progress.peSemesters, target: targets.peSemesters)
                RequirementRow(title: "本系必修", current: progress.homeCompulsory, target: targets.homeCompulsory)
                RequirementRow(title: "本系選修", current: progress.homeElective, target: targets.homeElective)

                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Text("已修通識向度")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.inkSecondary)
                        .accessibilityHidden(true)
                    GenEdStrip(completed: Array(progress.genEdDimensions))
                }
            }
            .panel()
        }
    }

    // MARK: Semesters

    private var semestersSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("八學期規劃", caption: "點課程開啟課堂筆記與成績試算")

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(store.plannerSemesters.enumerated()), id: \.element.id) { index, semester in
                    if index > 0 {
                        RuleLine()
                    }
                    semesterBlock(semester)
                }
            }
            .panel(padding: nil)
        }
    }

    private func semesterBlock(_ semester: PlannerSemester) -> some View {
        let isExpanded = expandedSemesters.contains(semester.id)
        let credits = Int(store.credits(for: semester))

        return VStack(alignment: .leading, spacing: 0) {
            Button {
                toggleSemester(semester.id)
            } label: {
                HStack(alignment: .center, spacing: Theme.Space.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(semester.name)
                            .font(.headline)
                            .foregroundStyle(Theme.ink)
                        Text("\(semester.courses.count) 門課")
                            .font(.caption)
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer(minLength: Theme.Space.s)
                    Text("\(credits)")
                        .font(.system(.title3, design: .monospaced).weight(.heavy))
                        .foregroundStyle(Theme.ink)
                    + Text(" 學分")
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Theme.inkSecondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, Theme.Space.l)
                .padding(.vertical, Theme.Space.m)
                .contentShape(Rectangle())
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityElement(children: .combine)
            .accessibilityValue(isExpanded ? "已展開" : "已收合")

            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    if semester.courses.isEmpty {
                        Text("這學期尚未排入課程")
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                            .padding(.horizontal, Theme.Space.l)
                            .padding(.bottom, Theme.Space.m)
                    }
                    ForEach(semester.courses) { course in
                        RuleLine()
                            .padding(.leading, Theme.Space.l)
                        Button {
                            selectedCourseContext = PlannerCourseContext(
                                semesterID: semester.id,
                                semesterName: semester.name,
                                course: course
                            )
                        } label: {
                            PlannerCourseRow(course: course)
                        }
                        .buttonStyle(RowButtonStyle())
                        .accessibilityHint("開啟課堂筆記與成績試算")
                    }
                }
                .transition(.opacity)
            }
        }
    }

    private func toggleSemester(_ id: UUID) {
        withAnimation(.snappy(duration: 0.25)) {
            if expandedSemesters.contains(id) {
                expandedSemesters.remove(id)
            } else {
                expandedSemesters.insert(id)
            }
        }
    }
}

private struct PlannerCourseRow: View {
    let course: PlannerCourse

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            Circle()
                .fill(course.category.themeColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                    Text(course.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.Space.s)
                    Tag(text: course.category.title)
                }

                metaLine

                if !course.time.isEmpty || !course.location.isEmpty {
                    HStack(spacing: Theme.Space.m) {
                        if !course.time.isEmpty {
                            Label(course.time, systemImage: "clock")
                        }
                        if !course.location.isEmpty {
                            Label(course.location, systemImage: "mappin")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.inkSecondary)
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(Theme.inkTertiary)
                .padding(.top, 3)
                .accessibilityHidden(true)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Theme.Space.l)
        .padding(.vertical, Theme.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 課碼取自網頁版寫入的 scheduledOffering
    private var metaLine: some View {
        var rest: [String] = ["\(String(format: "%.0f", course.credits)) 學分", course.program.title]
        if course.dimension != .none {
            rest.append(course.dimension.title)
        }
        let tail = Text(rest.joined(separator: "・")).font(.caption.monospacedDigit())
        let line = course.courseNo.isEmpty
            ? tail
            : Text(course.courseNo).font(Theme.Typeface.codeSmall) + Text("・").font(.caption) + tail
        return line
            .foregroundStyle(Theme.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct PlannerCourseContext: Identifiable {
    let semesterID: UUID
    let semesterName: String
    let course: PlannerCourse

    var id: UUID { course.id }
}

struct TargetSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var targets: PlannerTarget

    let onSave: (PlannerTarget) -> Void

    init(initialTargets: PlannerTarget, onSave: @escaping (PlannerTarget) -> Void) {
        self.onSave = onSave
        _targets = State(initialValue: initialTargets)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("共同必修") {
                    numberField(title: "總學分", value: $targets.total)
                    numberField(title: "國文", value: $targets.chinese)
                    numberField(title: "英文", value: $targets.english)
                    numberField(title: "通識", value: $targets.genEd)
                    numberField(title: "體育學期數", value: $targets.peSemesters)
                    numberField(title: "社會實踐", value: $targets.social)
                }
                .listRowBackground(Theme.surface)

                Section("系所門檻") {
                    numberField(title: "本系必修", value: $targets.homeCompulsory)
                    numberField(title: "本系選修", value: $targets.homeElective)
                    numberField(title: "雙主修", value: $targets.doubleMajor)
                    numberField(title: "輔修", value: $targets.minor)
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas.ignoresSafeArea())
            .navigationTitle("畢業門檻")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("儲存") {
                        onSave(targets)
                        dismiss()
                    }
                }
            }
        }
        .tint(Theme.signal)
        .presentationDetents([.large])
    }

    private func numberField(title: String, value: Binding<Double>) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(Theme.ink)
            Spacer()
            TextField(title, value: value, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(Theme.Typeface.code)
                .foregroundStyle(Theme.inkSecondary)
                .frame(maxWidth: 90)
        }
    }
}
