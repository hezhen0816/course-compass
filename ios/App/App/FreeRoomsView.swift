import SwiftUI

struct FreeRoomsView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var currentStatus: TRRoomStatusResponse?
    @State private var nextStatus: TRRoomStatusResponse?
    @State private var roomQuery = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                pageHeader
                nextStatusPanel
                roomLookup
                nextRoomsSection
                currentRoomsSection
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
            guard currentStatus == nil, nextStatus == nil else {
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

    private var nextStatusPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "figure.walk.motion")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.indigo, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text(nextStatus.map { "下一節：\($0.nodeLabel)" } ?? "正在讀取下一節")
                        .font(.title3.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(statusSubtitle(for: nextStatus))
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

            if let nextStatus {
                HStack(spacing: 10) {
                    metricPill(title: "下一節空堂", value: "\(nextStatus.freeRooms.count)")
                    metricPill(title: "下一節有課", value: "\(nextStatus.busyRooms.count)")
                    metricPill(title: "TR 教室", value: "\(nextStatus.totalRooms)")
                }

                if let currentStatus {
                    currentSummary(status: currentStatus)
                }

                Text(nextStatus.note)
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
            sectionHeader(title: "查單一教室", subtitle: "同時確認目前和下一節能不能去")

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

            if hasRoomResult {
                VStack(spacing: 12) {
                    if let currentStatus, currentStatus.room != nil {
                        roomAvailabilityCard(title: "目前", status: currentStatus)
                    }
                    if let nextStatus, nextStatus.room != nil {
                        roomAvailabilityCard(title: "下一節", status: nextStatus)
                    }
                }
            }
        }
    }

    private var nextRoomsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(title: "下一節空堂", subtitle: "可以直接考慮去這些 TR 教室")

            if let rooms = nextStatus?.freeRooms, !rooms.isEmpty {
                roomGrid(rooms, tint: .green)
            } else {
                ContentUnavailableView(
                    "沒有可顯示的下一節空教室",
                    systemImage: "door.left.hand.closed",
                    description: Text("下拉重新整理，或稍後再試。")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
            }
        }
    }

    private var currentRoomsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            DisclosureGroup {
                if let currentStatus, currentStatus.isClassTime, !currentStatus.freeRooms.isEmpty {
                    roomGrid(currentStatus.freeRooms, tint: .teal)
                        .padding(.top, 10)
                } else {
                    Text("目前不是正式節次，先看下一節比較準。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            } label: {
                sectionHeader(title: "目前空堂", subtitle: currentStatus?.nodeLabel ?? "正在讀取目前節次")
            }
            .tint(.indigo)
        }
    }

    private var busyRoomsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            DisclosureGroup {
                if let rooms = nextStatus?.busyRooms, !rooms.isEmpty {
                    roomGrid(rooms, tint: .orange)
                        .padding(.top, 10)
                } else {
                    Text("下一節沒有有課教室。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            } label: {
                sectionHeader(title: "下一節有課教室", subtitle: "展開查看下一節被佔用的 TR 教室")
            }
            .tint(.indigo)
        }
    }

    private var hasRoomResult: Bool {
        currentStatus?.room != nil || nextStatus?.room != nil
    }

    private func statusSubtitle(for status: TRRoomStatusResponse?) -> String {
        guard let status else {
            return "正在讀取台科大課程查詢系統"
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.dateFormat = "M/d HH:mm"
        return "學期 \(status.semester)・更新 \(formatter.string(from: status.queriedAt))"
    }

    private func currentSummary(status: TRRoomStatusResponse) -> some View {
        HStack(spacing: 8) {
            Label("目前：\(status.nodeLabel)", systemImage: "clock")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if status.isClassTime {
                Text("\(status.freeRooms.count) 間空堂")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.teal)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.teal.opacity(0.12), in: Capsule())
            }
        }
        .padding(12)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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

    @ViewBuilder
    private func roomAvailabilityCard(title: String, status: TRRoomStatusResponse) -> some View {
        if let room = status.room, let isFree = status.roomIsFree {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(room)
                            .font(.title3.weight(.bold))
                    }
                    Spacer()
                    Text(isFree ? "空堂" : "有課")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isFree ? Color.green : Color.orange)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background((isFree ? Color.green : Color.orange).opacity(0.12), in: Capsule())
                }

                Text(status.nodeLabel)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if status.roomMeetings.isEmpty {
                    Text("\(title)沒有正式課表資料。")
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
        } else {
            EmptyView()
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
            let nextResponse = try await store.loadTRRoomStatus(room: roomQuery, target: "next", refresh: refresh)
            let currentResponse = try await store.loadTRRoomStatus(room: roomQuery, target: "current", refresh: false)
            nextStatus = nextResponse
            currentStatus = currentResponse
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
