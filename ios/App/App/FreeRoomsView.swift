import SwiftUI

struct FreeRoomsView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var currentStatus: TRRoomStatusResponse?
    @State private var nextStatus: TRRoomStatusResponse?
    @State private var roomQuery = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    // Hides the previous room's cards when a later lookup fails (e.g. 404 for an unknown room).
    @State private var roomResultVisible = false
    @State private var isCurrentExpanded = false
    @State private var isBusyExpanded = false
    @FocusState private var isQueryFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                ScreenHeader(eyebrow: statusSubtitle(for: nextStatus), title: "空教室") {
                    if isLoading {
                        ProgressView()
                            .accessibilityLabel("讀取中")
                    }
                }
                roomLookup
                departureBoard
                nextRoomsSection
                currentRoomsSection
                busyRoomsSection
            }
            .screenPadding()
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            await loadStatus(refresh: true)
        }
        .screenChrome()
        .task {
            guard currentStatus == nil, nextStatus == nil else {
                return
            }
            await loadStatus(refresh: false)
        }
    }

    // MARK: Lookup

    private var roomLookup: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                HStack(spacing: Theme.Space.s) {
                    Image(systemName: "magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.inkSecondary)
                        .accessibilityHidden(true)
                    TextField("TR-613", text: $roomQuery)
                        .font(Theme.Typeface.code)
                        .foregroundStyle(Theme.ink)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled(true)
                        .keyboardType(.asciiCapable)
                        .submitLabel(.search)
                        .focused($isQueryFocused)
                        .accessibilityLabel("教室代碼")
                        .onSubmit {
                            Task {
                                await loadStatus(refresh: false)
                            }
                        }
                }
                .fieldChrome()

                Button {
                    isQueryFocused = false
                    Task {
                        await loadStatus(refresh: false)
                    }
                } label: {
                    Text("查詢")
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(isLoading)
                .accessibilityLabel("查詢教室")
            }

            Text("查單一教室：同時確認目前和下一節能不能去")
                .font(.caption)
                .foregroundStyle(Theme.inkSecondary)

            if let errorMessage {
                Callout(text: errorMessage, tone: .danger, systemImage: "exclamationmark.triangle.fill")
            }

            if hasRoomResult {
                roomResultPanel
            }
        }
    }

    private var roomResultPanel: some View {
        let rows: [(String, TRRoomStatusResponse)] = [
            ("目前", currentStatus),
            ("下一節", nextStatus)
        ].compactMap { title, status in
            guard let status, status.room != nil, status.roomIsFree != nil else { return nil }
            return (title, status)
        }
        let roomName = currentStatus?.room ?? nextStatus?.room ?? ""

        return VStack(alignment: .leading, spacing: 0) {
            Text(roomName)
                .font(.system(.title2, design: .monospaced).weight(.heavy))
                .foregroundStyle(Theme.ink)
                .padding(.bottom, Theme.Space.s)

            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                RuleLine()
                roomAvailabilityRow(title: row.0, status: row.1)
                    .padding(.vertical, Theme.Space.m)
            }
        }
        .panel()
    }

    @ViewBuilder
    private func roomAvailabilityRow(title: String, status: TRRoomStatusResponse) -> some View {
        if let isFree = status.roomIsFree {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                HStack(alignment: .center, spacing: Theme.Space.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.subheadline.weight(.heavy))
                            .foregroundStyle(Theme.ink)
                        Text(status.nodeLabel)
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: Theme.Space.s)
                    Text(isFree ? "空堂" : "有課")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(Theme.onFill)
                        .padding(.horizontal, Theme.Space.m)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                                .fill(isFree ? Theme.go : Theme.busy)
                        )
                        .fixedSize()
                }

                if status.roomMeetings.isEmpty {
                    Text("\(title)沒有正式課表資料。")
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                } else {
                    ForEach(status.roomMeetings) { meeting in
                        meetingRow(meeting)
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func meetingRow(_ meeting: TRRoomMeeting) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(meeting.courseName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Theme.Space.m) {
                Text(meeting.node)
                    .font(Theme.Typeface.codeSmall)
                if !meeting.teacher.isEmpty {
                    Text(meeting.teacher)
                        .font(.caption)
                }
            }
            .foregroundStyle(Theme.inkSecondary)
        }
        .padding(.leading, Theme.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Theme.busy)
                .frame(width: 2)
        }
    }

    // MARK: Board

    private var departureBoard: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text("下一節")
                    .font(.footnote.weight(.heavy))
                    .foregroundStyle(Theme.signal)
                Text(nextStatus?.nodeLabel ?? "正在讀取下一節")
                    .font(.title2.weight(.heavy))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Theme.Space.l)

            if let nextStatus {
                RuleLine()
                HStack(spacing: 0) {
                    boardFigure(value: nextStatus.freeRooms.count, label: "下一節空堂", color: Theme.go)
                    verticalRule
                    boardFigure(value: nextStatus.busyRooms.count, label: "下一節有課", color: Theme.busy)
                    verticalRule
                    boardFigure(value: nextStatus.totalRooms, label: "TR 教室", color: Theme.ink)
                }
                .fixedSize(horizontal: false, vertical: true)

                if let currentStatus {
                    RuleLine()
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                        Text("目前")
                            .font(.footnote.weight(.heavy))
                            .foregroundStyle(Theme.ink)
                        Text(currentStatus.nodeLabel)
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Theme.Space.s)
                        if currentStatus.isClassTime {
                            Tag(text: "\(currentStatus.freeRooms.count) 間空堂", tone: .go)
                        }
                    }
                    .padding(.horizontal, Theme.Space.l)
                    .padding(.vertical, Theme.Space.m)
                    .accessibilityElement(children: .combine)
                }

                if !nextStatus.note.isEmpty {
                    RuleLine()
                    Text(nextStatus.note)
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Theme.Space.l)
                        .padding(.vertical, Theme.Space.m)
                }
            }
        }
        .panel(padding: nil)
    }

    private var verticalRule: some View {
        Rectangle()
            .fill(Theme.rule)
            .frame(width: 1)
            .accessibilityHidden(true)
    }

    private func boardFigure(value: Int, label: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(value)")
                .font(.system(.largeTitle, design: .default).weight(.heavy))
                .fontWidth(.compressed)
                .monospacedDigit()
                .foregroundStyle(color)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, Theme.Space.m)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) \(value) 間")
    }

    // MARK: Room lists

    private var nextRoomsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            SectionHeading("下一節空堂", caption: "可以直接考慮去這些 TR 教室") {
                if let count = nextStatus?.freeRooms.count, count > 0 {
                    Text("\(count) 間")
                        .font(Theme.Typeface.count)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }

            if let rooms = nextStatus?.freeRooms, !rooms.isEmpty {
                RoomGrid(rooms: rooms, tone: .go)
            } else {
                EmptyNote(
                    title: "沒有可顯示的下一節空教室",
                    message: "下拉重新整理，或稍後再試。",
                    systemImage: "door.left.hand.closed"
                )
            }
        }
    }

    private var currentRoomsSection: some View {
        FoldSection(
            title: "目前空堂",
            caption: currentStatus?.nodeLabel ?? "正在讀取目前節次",
            isExpanded: $isCurrentExpanded
        ) {
            if let currentStatus, currentStatus.isClassTime, !currentStatus.freeRooms.isEmpty {
                RoomGrid(rooms: currentStatus.freeRooms, tone: .go)
            } else {
                Text("目前不是正式節次，先看下一節比較準。")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private var busyRoomsSection: some View {
        FoldSection(
            title: "下一節有課教室",
            caption: "展開查看下一節被佔用的 TR 教室",
            isExpanded: $isBusyExpanded
        ) {
            if let rooms = nextStatus?.busyRooms, !rooms.isEmpty {
                RoomGrid(rooms: rooms, tone: .busy)
            } else {
                Text("下一節沒有有課教室。")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    // MARK: Data

    private var hasRoomResult: Bool {
        roomResultVisible && (currentStatus?.room != nil || nextStatus?.room != nil)
    }

    private func statusSubtitle(for status: TRRoomStatusResponse?) -> String {
        guard let status else {
            return "正在讀取台科大課程查詢系統"
        }
        return "學期 \(status.semester)・更新 \(TWDate.string(status.queriedAt, "M/d HH:mm"))"
    }

    private func loadStatus(refresh: Bool) async {
        isLoading = true
        errorMessage = nil
        do {
            async let nextRequest = store.loadTRRoomStatus(room: roomQuery, target: "next", refresh: refresh)
            async let currentRequest = store.loadTRRoomStatus(room: roomQuery, target: "current", refresh: false)
            let (nextResponse, currentResponse) = try await (nextRequest, currentRequest)
            nextStatus = nextResponse
            currentStatus = currentResponse
            roomResultVisible = true
        } catch {
            if AppSessionStore.isCancellation(error) {
                isLoading = false
                return
            }
            errorMessage = error.localizedDescription
            roomResultVisible = false
        }
        isLoading = false
    }
}

/// Room codes laid out like a departure board: mono code, coloured left stripe.
private struct RoomGrid: View {
    let rooms: [String]
    let tone: Tone

    @ScaledMetric(relativeTo: .subheadline) private var minimumTileWidth: CGFloat = 92

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimumTileWidth), spacing: Theme.Space.s)], spacing: Theme.Space.s) {
            ForEach(rooms, id: \.self) { room in
                Text(room)
                    .font(Theme.Typeface.code)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, Theme.Space.m)
                    .padding(.trailing, Theme.Space.xs)
                    .padding(.vertical, 10)
                    .background(tone.color.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous))
            }
        }
    }
}

#Preview {
    FreeRoomsView()
        .environmentObject(AppSessionStore())
}
