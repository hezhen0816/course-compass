import SwiftUI

struct FreeRoomsView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var status: TRRoomStatusResponse?
    @State private var roomQuery = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                pageHeader
                statusPanel
                roomLookup
                freeRoomsSection
                busyRoomsSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .refreshable {
            await loadStatus(refresh: true)
        }
        .background(Color(.systemGroupedBackground))
        .toolbar(.hidden, for: .navigationBar)
        .task {
            guard status == nil else {
                return
            }
            await loadStatus(refresh: false)
        }
    }

    private var pageHeader: some View {
        Text("空教室")
            .font(.system(size: 34, weight: .bold, design: .rounded))
            .foregroundStyle(.primary)
            .padding(.top, 4)
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "door.left.hand.open")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.indigo, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text(status?.nodeLabel ?? "正在讀取節次")
                        .font(.title3.weight(.bold))
                    Text(statusSubtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if isLoading {
                    ProgressView()
                }
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if let status {
                HStack(spacing: 10) {
                    metricPill(title: "空堂", value: "\(status.freeRooms.count)")
                    metricPill(title: "有課", value: "\(status.busyRooms.count)")
                    metricPill(title: "TR 教室", value: "\(status.totalRooms)")
                }

                Text(status.note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var roomLookup: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(title: "查單一教室", subtitle: "輸入 TR-613 這類教室代碼")

            HStack(spacing: 10) {
                TextField("TR-613", text: $roomQuery)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled(true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .submitLabel(.search)
                    .onSubmit {
                        Task {
                            await loadStatus(refresh: false)
                        }
                    }

                Button {
                    Task {
                        await loadStatus(refresh: false)
                    }
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(Color.indigo, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(isLoading)
            }

            if let status, let room = status.room, let isFree = status.roomIsFree {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(room)
                            .font(.title3.weight(.bold))
                        Spacer()
                        Text(isFree ? "空堂" : "有課")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isFree ? Color.green : Color.orange)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background((isFree ? Color.green : Color.orange).opacity(0.12), in: Capsule())
                    }

                    if status.roomMeetings.isEmpty {
                        Text("這個節次沒有正式課表資料。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(status.roomMeetings) { meeting in
                            meetingRow(meeting)
                        }
                    }
                }
                .padding(16)
                .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }

    private var freeRoomsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(title: "目前空堂", subtitle: "依本學期正式課表推定")

            if let rooms = status?.freeRooms, !rooms.isEmpty {
                roomGrid(rooms, tint: .green)
            } else {
                ContentUnavailableView(
                    "沒有可顯示的空堂教室",
                    systemImage: "door.left.hand.closed",
                    description: Text("下拉重新整理，或稍後再試。")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
            }
        }
    }

    private var busyRoomsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            DisclosureGroup {
                if let rooms = status?.busyRooms, !rooms.isEmpty {
                    roomGrid(rooms, tint: .orange)
                        .padding(.top, 10)
                } else {
                    Text("目前沒有有課教室。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            } label: {
                sectionHeader(title: "有課教室", subtitle: "展開查看此節次被佔用的 TR 教室")
            }
            .tint(.indigo)
        }
    }

    private var statusSubtitle: String {
        guard let status else {
            return "正在讀取台科大課程查詢系統"
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.dateFormat = "M/d HH:mm"
        return "學期 \(status.semester)・更新 \(formatter.string(from: status.queriedAt))"
    }

    private func sectionHeader(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title3.weight(.bold))
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func metricPill(title: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline.weight(.bold))
                .monospacedDigit()
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func roomGrid(_ rooms: [String], tint: Color) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
            ForEach(rooms, id: \.self) { room in
                Text(room)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private func meetingRow(_ meeting: TRRoomMeeting) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(meeting.courseName)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Label(meeting.node, systemImage: "clock")
                if !meeting.teacher.isEmpty {
                    Label(meeting.teacher, systemImage: "person.crop.rectangle")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func loadStatus(refresh: Bool) async {
        isLoading = true
        errorMessage = nil
        do {
            status = try await store.loadTRRoomStatus(room: roomQuery, refresh: refresh)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    FreeRoomsView()
        .environmentObject(AppSessionStore())
}
