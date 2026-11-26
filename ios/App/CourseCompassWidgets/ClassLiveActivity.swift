import ActivityKit
import SwiftUI
import WidgetKit

/// Dynamic Island and lock-screen presentation of the next class's classroom.
struct ClassLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClassActivityAttributes.self) { context in
            ClassLockScreenView(state: context.state, isStale: context.isStale)
        } dynamicIsland: { context in
            let state = context.state
            let phase = ClassPhase(state: state, isStale: context.isStale)

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(phase.label)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(phase == .live ? Palette.islandSignal : Color.secondary)
                        RoomText(room: state.room, font: .system(.title2, design: .monospaced).weight(.bold))
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(phase.countdownLabel)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        CountdownText(state: state, phase: phase)
                            .font(.title2.weight(.bold))
                            .foregroundStyle(phase == .live ? Palette.islandSignal : .white)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(state.title)
                                .font(.headline)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Text(TimeLabel.range(state.startDate, state.endDate))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        if let nextLine = NextClassLine(state: state) {
                            nextLine
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    Image(systemName: "mappin.circle.fill")
                        .foregroundStyle(Palette.islandSignal)
                    RoomText(room: state.room, font: .system(.caption, design: .monospaced).weight(.bold))
                        .frame(maxWidth: 72, alignment: .leading)
                }
            } compactTrailing: {
                // Ticking countdown to the start (or, once in class, to the end) instead of a clock
                // time, so it isn't mistaken for the status-bar clock the island covers.
                CountdownText(state: state, phase: phase)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(phase == .live ? Palette.islandSignal : .white)
                    .frame(maxWidth: 52, alignment: .trailing)
            } minimal: {
                Image(systemName: "mappin.circle.fill")
                    .foregroundStyle(Palette.islandSignal)
            }
            .keylineTint(Palette.islandSignal)
        }
    }
}

// MARK: - Lock screen

private struct ClassLockScreenView: View {
    @Environment(\.colorScheme) private var colorScheme
    let state: ClassActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let phase = ClassPhase(state: state, isStale: isStale)

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(phase.label)
                    .font(.footnote.weight(.heavy))
                    .foregroundStyle(phase == .live ? Palette.signal(colorScheme) : Color.secondary)
                Spacer(minLength: 8)
                Text(TimeLabel.range(state.startDate, state.endDate))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Color.secondary)
            }

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.title)
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                        .lineLimit(2)
                    HStack(spacing: 4) {
                        Image(systemName: "mappin")
                            .font(.footnote.weight(.bold))
                        RoomText(room: state.room, font: .system(.title3, design: .monospaced).weight(.bold))
                    }
                    .foregroundStyle(Color.primary)
                }
                Spacer(minLength: 8)
                if phase != .ended {
                    VStack(alignment: .trailing, spacing: 2) {
                        CountdownText(state: state, phase: phase)
                            .font(.title2.weight(.heavy))
                            .foregroundStyle(phase == .live ? Palette.signal(colorScheme) : Color.primary)
                        Text(phase.countdownLabel)
                            .font(.caption2)
                            .foregroundStyle(Color.secondary)
                    }
                }
            }

            if let nextLine = NextClassLine(state: state) {
                nextLine
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }
        }
        .padding(16)
    }
}

// MARK: - Pieces

private enum ClassPhase: Equatable {
    case upcoming
    case live
    case ended

    /// Live Activity views are rendered when the app pushes an update, so "now" here is the
    /// time of the last update; the timer texts keep counting on their own in between.
    init(state: ClassActivityAttributes.ContentState, isStale: Bool, now: Date = Date()) {
        if isStale || now >= state.endDate {
            self = .ended
        } else if now >= state.startDate {
            self = .live
        } else {
            self = .upcoming
        }
    }

    var label: String {
        switch self {
        case .upcoming:
            return "下一堂"
        case .live:
            return "上課中"
        case .ended:
            return "已下課・打開 App 更新"
        }
    }

    var countdownLabel: String {
        switch self {
        case .upcoming:
            return "後上課"
        case .live:
            return "後下課"
        case .ended:
            return ""
        }
    }
}

private struct CountdownText: View {
    let state: ClassActivityAttributes.ContentState
    let phase: ClassPhase

    var body: some View {
        switch phase {
        case .upcoming:
            Text(timerInterval: Date()...max(Date(), state.startDate), countsDown: true)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        case .live:
            Text(timerInterval: state.startDate...state.endDate, countsDown: true)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        case .ended:
            Text(TimeLabel.clock(state.endDate))
                .monospacedDigit()
        }
    }
}

private struct RoomText: View {
    let room: String
    let font: Font

    var body: some View {
        Text(room.isEmpty ? "教室未提供" : room)
            .font(room.isEmpty ? .caption.weight(.semibold) : font)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

private struct NextClassLine: View {
    let text: String

    init?(state: ClassActivityAttributes.ContentState) {
        guard let title = state.nextTitle, let start = state.nextStartDate else {
            return nil
        }
        var parts = ["接著 \(TimeLabel.clock(start))", title]
        if let room = state.nextRoom, !room.isEmpty {
            parts.append(room)
        }
        text = parts.joined(separator: " · ")
    }

    var body: some View {
        Text(text)
            .lineLimit(1)
    }
}

private enum TimeLabel {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func clock(_ date: Date) -> String {
        formatter.string(from: date)
    }

    static func range(_ start: Date, _ end: Date) -> String {
        "\(clock(start))–\(clock(end))"
    }
}

/// Same tokens as the app's Theme ("Calm Cards"); the Dynamic Island is always dark.
/// The lock-screen card draws no tint of its own: the system picks the background (iPhone material in
/// light or dark, or a dark translucent bar in the Mac menu bar) and pairs it with the environment color
/// scheme, so text uses semantic `.primary` / `.secondary` and only the accent blue switches by scheme.
/// A fixed tint with fixed or dynamic text broke on one of those hosts.
private enum Palette {
    static let islandSignal = Color(hex: 0x7C9CFF)

    static func signal(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? islandSignal : Color(hex: 0x2F5BD3)
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: ClassActivityAttributes()) {
    ClassLiveActivity()
} contentStates: {
    ClassActivityAttributes.ContentState.preview
}

#Preview("Lock screen", as: .content, using: ClassActivityAttributes()) {
    ClassLiveActivity()
} contentStates: {
    ClassActivityAttributes.ContentState.preview
}

private extension ClassActivityAttributes.ContentState {
    static var preview: Self {
        let start = Date().addingTimeInterval(25 * 60)
        return Self(
            title: "資料結構",
            room: "TR-313",
            startDate: start,
            endDate: start.addingTimeInterval(110 * 60),
            nextTitle: "管理學",
            nextRoom: "IB-505",
            nextStartDate: start.addingTimeInterval(140 * 60)
        )
    }
}
