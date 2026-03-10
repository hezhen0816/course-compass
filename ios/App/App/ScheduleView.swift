import SwiftUI

struct ScheduleView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var selectedWeekday: Weekday = Weekday.currentWeekday()

    private var filteredEntries: [ScheduleEntry] {
        store.scheduleEntries.filter { $0.weekday == selectedWeekday }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                pageHeader
                VStack(alignment: .leading, spacing: 10) {
                    Text("本週課表")
                        .font(.title3.weight(.bold))
                    Text(store.lastSyncedAt == nil ? "以單日時間軸呈現，保留 iPhone 直向閱讀節奏。" : "顯示最近一次雲端同步完成後的課表資料。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if case .failed(let message) = store.syncState {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    } else if let lastSyncedAt = store.lastSyncedAt {
                        Label("上次同步 \(formatted(lastSyncedAt))", systemImage: "clock.arrow.circlepath")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Picker("星期", selection: $selectedWeekday) {
                        ForEach(Weekday.allCases) { weekday in
                            Text(weekday.shortTitle).tag(weekday)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(20)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                if filteredEntries.isEmpty {
                    ContentUnavailableView(
                        "今天沒有排課",
                        systemImage: "calendar.badge.exclamationmark",
                        description: Text("可以保留給專題、作業或自修安排。")
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.top, 36)
                } else {
                    ForEach(filteredEntries) { entry in
                        HStack(alignment: .top, spacing: 14) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.timeRange)
                                    .font(.headline.weight(.bold))
                                Text(entry.weekday.fullTitle)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 96, alignment: .leading)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(entry.title)
                                        .font(.headline)
                                    Spacer()
                                    Circle()
                                        .fill(entry.accent.tint)
                                        .frame(width: 10, height: 10)
                                }

                                HStack(spacing: 12) {
                                    Label(entry.room, systemImage: "mappin.and.ellipse")
                                    Label(entry.instructor, systemImage: "person.crop.rectangle")
                                }
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(entry.accent.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Color(.systemGroupedBackground))
        .toolbar(.hidden, for: .navigationBar)
    }

    private var pageHeader: some View {
        Text("課表")
            .font(.system(size: 34, weight: .bold, design: .rounded))
            .foregroundStyle(.primary)
            .padding(.top, 4)
    }

    private func formatted(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.dateFormat = "M/d HH:mm"
        return formatter.string(from: date)
    }
}
