import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var infoMessage: InfoMessage?
    @State private var isTargetSheetPresented = false
    @State private var isSyncing = false
    @State private var isImportingHistory = false
    @State private var isSyncingMoodleAssignments = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                ScreenHeader(eyebrow: nil, title: "設定")

                accountGroup
                schoolGroup
                syncGroup
                reminderGroup
                securityGroup
                plannerGroup
                aboutGroup

                Button(role: .destructive) {
                    Task {
                        await store.signOut()
                    }
                } label: {
                    Label("登出帳號", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(OutlineButtonStyle(tone: .danger))
            }
            .screenPadding()
        }
        .scrollDismissesKeyboard(.interactively)
        .screenChrome()
        .alert(item: $infoMessage) { message in
            Alert(
                title: Text(message.title),
                message: Text(message.message),
                dismissButton: .default(Text("知道了"))
            )
        }
        .sheet(isPresented: $isTargetSheetPresented) {
            TargetSettingsSheet(
                initialTargets: store.plannerTargets,
                onSave: { targets in
                    store.updateTargets(targets)
                }
            )
        }
    }

    // MARK: Groups

    private var accountGroup: some View {
        SettingsGroup(title: "帳號") {
            VStack(alignment: .leading, spacing: 2) {
                Text("目前使用帳號")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.inkSecondary)
                Text(store.currentUserEmail ?? "未登入")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .settingsRowPadding()
            .accessibilityElement(children: .combine)

            if let authNoticeMessage = store.authNoticeMessage {
                RuleLine()
                Text(authNoticeMessage)
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .settingsRowPadding()
            }
        }
    }

    private var schoolGroup: some View {
        SettingsGroup(
            title: "校務系統",
            footer: "每次同步時請輸入校務密碼。後端會用它登入台科大系統。"
        ) {
            labeledField(label: "帳號") {
                TextField("學號 / 校務帳號", text: $store.schoolAccount)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .font(Theme.Typeface.code)
                    .accessibilityLabel("學號 / 校務帳號")
            }
            RuleLine()
            labeledField(label: "密碼") {
                SecureField("密碼", text: $store.schoolPassword)
                    .accessibilityLabel("校務系統密碼")
            }
        }
    }

    private var syncGroup: some View {
        SettingsGroup(title: "資料同步") {
            Button {
                isSyncing = true
                Task {
                    await store.syncSchedule()
                    isSyncing = false
                }
            } label: {
                ActionRow(
                    title: isSyncing ? "同步中..." : "同步課表",
                    subtitle: "更新雲端課表，並同步到這支 iPhone",
                    symbol: "arrow.triangle.2.circlepath",
                    isRunning: isSyncing
                )
            }
            .buttonStyle(RowButtonStyle())
            .disabled(isSyncing)

            RuleLine()

            Button {
                isSyncingMoodleAssignments = true
                Task {
                    await store.syncMoodleAssignments()
                    isSyncingMoodleAssignments = false
                }
            } label: {
                ActionRow(
                    title: isSyncingMoodleAssignments ? "同步中..." : "同步待繳事項",
                    subtitle: "更新 Moodle 待繳作業，並同步到這支 iPhone",
                    symbol: "checklist.checked",
                    isRunning: isSyncingMoodleAssignments
                )
            }
            .buttonStyle(RowButtonStyle())
            .disabled(isSyncingMoodleAssignments)

            RuleLine()

            Button {
                isImportingHistory = true
                Task {
                    await store.importAcademicHistory()
                    isImportingHistory = false
                }
            } label: {
                ActionRow(
                    title: isImportingHistory ? "匯入中..." : "匯入歷史修課紀錄",
                    subtitle: "整理歷年修課資料，並更新到學分規劃",
                    symbol: "square.and.arrow.down.on.square",
                    isRunning: isImportingHistory
                )
            }
            .buttonStyle(RowButtonStyle())
            .disabled(isImportingHistory)

            RuleLine()

            VStack(alignment: .leading, spacing: Theme.Space.s) {
                if case .failed(let message) = store.syncState {
                    statusLine(message, tone: .danger)
                } else {
                    statusLine(syncStatusDescription, tone: .neutral)
                }

                if let historyImportErrorMessage = store.historyImportErrorMessage {
                    statusLine(historyImportErrorMessage, tone: .danger)
                } else if let historyImportNoticeMessage = store.historyImportNoticeMessage {
                    statusLine(historyImportNoticeMessage, tone: .neutral)
                }

                if let moodleAssignmentsErrorMessage = store.moodleAssignmentsErrorMessage {
                    statusLine(moodleAssignmentsErrorMessage, tone: .danger)
                } else if let moodleAssignmentsNoticeMessage = store.moodleAssignmentsNoticeMessage {
                    statusLine(moodleAssignmentsNoticeMessage, tone: .neutral)
                }
            }
            .settingsRowPadding()
        }
    }

    private var reminderGroup: some View {
        SettingsGroup(title: "提醒") {
            HStack(spacing: Theme.Space.m) {
                Text("課前提醒")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: Theme.Space.s)
                Picker("課前提醒", selection: $store.reminderMinutes) {
                    ForEach([0, 5, 10, 15, 30, 60], id: \.self) { minutes in
                        Text(minutes == 0 ? "關閉" : "\(minutes) 分鐘前").tag(minutes)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }
            .settingsRowPadding(vertical: Theme.Space.s)

            RuleLine()

            Toggle(isOn: $store.isClassLiveActivityEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("動態島顯示下一節課")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("在動態島與鎖定畫面顯示今天下一節課的教室與倒數")
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Theme.go)
            .settingsRowPadding(vertical: Theme.Space.s)

            RuleLine()

            Group {
                if let reminderErrorMessage = store.reminderErrorMessage {
                    statusLine(reminderErrorMessage, tone: .danger)
                } else if let reminderNoticeMessage = store.reminderNoticeMessage {
                    statusLine(reminderNoticeMessage, tone: .neutral)
                } else {
                    statusLine("會使用 iPhone 系統通知建立每週課前提醒，第一次啟用時會要求通知權限。", tone: .neutral)
                }
            }
            .settingsRowPadding()
        }
    }

    private var securityGroup: some View {
        SettingsGroup(title: "安全性") {
            Toggle(isOn: biometricToggleBinding) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(store.localizedBiometricName) 登入")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("離開 App 超過設定的時間後，回來要先完成本機解鎖")
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Theme.go)
            .disabled(store.isBiometricAuthenticating)
            .settingsRowPadding()

            if store.isBiometricAuthEnabled {
                RuleLine()
                HStack(spacing: Theme.Space.m) {
                    Text("自動鎖定")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Spacer(minLength: Theme.Space.s)
                    Picker("自動鎖定", selection: biometricGraceBinding) {
                        ForEach(AppSessionStore.biometricLockGraceOptions, id: \.self) { minutes in
                            Text(Self.graceLabel(minutes)).tag(minutes)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
                .settingsRowPadding(vertical: Theme.Space.s)

                RuleLine()
                Button {
                    store.lockForBiometricUnlockIfNeeded()
                } label: {
                    ActionRow(title: "立即鎖定 App", subtitle: nil, symbol: "lock.fill", isRunning: false)
                }
                .buttonStyle(RowButtonStyle())
            }

            RuleLine()
            Group {
                if let biometricAuthErrorMessage = store.biometricAuthErrorMessage {
                    statusLine(biometricAuthErrorMessage, tone: .danger)
                } else {
                    statusLine("此功能只保護這支裝置上的 App 解鎖；登出後會清除本機 Face ID 設定。", tone: .neutral)
                }
            }
            .settingsRowPadding()
        }
    }

    private var plannerGroup: some View {
        let progress = store.plannerProgress

        return SettingsGroup(title: "學分規劃") {
            Button {
                isTargetSheetPresented = true
            } label: {
                ActionRow(title: "設定畢業門檻", subtitle: "調整你的學分目標與畢業條件", symbol: "slider.horizontal.3", isRunning: false)
            }
            .buttonStyle(RowButtonStyle())

            RuleLine()

            VStack(alignment: .leading, spacing: Theme.Space.m) {
                Text("目前進度摘要")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.inkSecondary)
                    .accessibilityAddTraits(.isHeader)
                RequirementRow(title: "總學分", current: progress.total, target: store.plannerTargets.total)
                RequirementRow(title: "通識", current: progress.genEd, target: store.plannerTargets.genEd)
                RequirementRow(title: "本系必修", current: progress.homeCompulsory, target: store.plannerTargets.homeCompulsory)
            }
            .settingsRowPadding()
        }
    }

    private var aboutGroup: some View {
        SettingsGroup(title: "關於 App") {
            Button {
                infoMessage = InfoMessage(title: "修課羅盤", message: "修課羅盤整合課表、歷史修課紀錄與學分規劃，讓你能在同一個 App 追蹤自己的修課進度。")
            } label: {
                ActionRow(title: "查看 App 介紹", subtitle: "了解這個 App 的主要功能與定位", symbol: "book.closed", isRunning: false)
            }
            .buttonStyle(RowButtonStyle())
        }
    }

    // MARK: Pieces

    private func labeledField<Field: View>(label: String, @ViewBuilder field: () -> Field) -> some View {
        HStack(spacing: Theme.Space.m) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.inkSecondary)
                .frame(minWidth: 40, alignment: .leading)
                .accessibilityHidden(true)
            field()
                .foregroundStyle(Theme.ink)
        }
        .settingsRowPadding()
    }

    private func statusLine(_ text: String, tone: Tone) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(tone == .neutral ? Theme.inkSecondary : tone.color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var biometricToggleBinding: Binding<Bool> {
        Binding(
            get: {
                store.isBiometricAuthEnabled
            },
            set: { isEnabled in
                Task {
                    await store.setBiometricAuthEnabled(isEnabled)
                }
            }
        )
    }

    private var biometricGraceBinding: Binding<Int> {
        Binding(
            get: { store.biometricLockGraceMinutes },
            set: { store.setBiometricLockGraceMinutes($0) }
        )
    }

    private static func graceLabel(_ minutes: Int) -> String {
        switch minutes {
        case 0:
            return "立即"
        case 60:
            return "1 小時"
        default:
            return "\(minutes) 分鐘"
        }
    }

    private var syncStatusDescription: String {
        if let lastSyncedAt = store.lastSyncedAt {
            return "\(store.syncState.label)・上次同步 \(TWDate.string(lastSyncedAt, "M/d HH:mm"))"
        }
        return store.syncState.label
    }
}

/// Titled group: section heading above a flat panel whose rows are separated by hairlines.
private struct SettingsGroup<Content: View>: View {
    let title: String
    var footer: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            Text(title)
                .font(Theme.Typeface.sectionTitle)
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 0) {
                content()
            }
            .panel(padding: nil)

            if let footer {
                Text(footer)
                    .font(.caption)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Tappable settings row: title and optional subtitle on the left, action glyph or spinner on the right.
private struct ActionRow: View {
    let title: String
    let subtitle: String?
    let symbol: String
    let isRunning: Bool

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Theme.Space.s)
            if isRunning {
                ProgressView()
            } else {
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.signal)
                    .accessibilityHidden(true)
            }
        }
        .multilineTextAlignment(.leading)
        .settingsRowPadding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private extension View {
    func settingsRowPadding(vertical: CGFloat = Theme.Space.m) -> some View {
        self
            .padding(.horizontal, Theme.Space.l)
            .padding(.vertical, vertical)
    }
}
