import SwiftUI
import UIKit

/*
 Design direction: "Calm Cards" (2026-10, shared with the web app's global.css tokens)

 The app should feel like a built-in iOS app: a cool light-grey canvas, white rounded
 cards with a barely-there shadow, and one blue signal colour for "now / live / primary
 action". Green means "free / done", amber "busy", red is reserved for errors, clashes and
 full courses. Category colours appear as soft tinted fills, never as stripes or borders.
 Typography: SF Pro throughout, heavy weights for titles, tabular digits for times and
 counts; SF Mono only for codes you copy into the real world (room and course codes).
 All sizes are text styles or @ScaledMetric so Dynamic Type scales the whole layout.
 Spacing is a 4-pt scale (4/8/12/16/24/32) with a 16-pt screen gutter. Shapes are soft:
 16-pt cards, 8-pt tags and fields, capsule meters. Icons are SF Symbols. Motion is
 minimal and functional and respects Reduce Motion.
*/

enum Theme {
    // MARK: Palette (semantic tokens, light / dark)

    static let canvas = dynamic(light: 0xF1F3F7, dark: 0x0E1117)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x1A1F27)
    static let sunken = dynamic(light: 0xE9EDF4, dark: 0x252B35)
    static let ink = dynamic(light: 0x1A2030, dark: 0xEEF1F6)
    static let inkSecondary = dynamic(light: 0x5D6578, dark: 0xA3ABBA)
    static let inkTertiary = dynamic(light: 0x7A8396, dark: 0x7A8394)
    static let rule = dynamic(light: 0xE3E7EE, dark: 0x2C333F)
    static let signal = dynamic(light: 0x2F5BD3, dark: 0x7C9CFF)
    static let go = dynamic(light: 0x17704A, dark: 0x4CC38A)
    static let busy = dynamic(light: 0x9A5800, dark: 0xF2B33D)
    static let danger = dynamic(light: 0xC8372D, dark: 0xFF6B5E)
    /// Text drawn on a filled tone (signal / go / busy / danger) or on ink.
    static let onFill = dynamic(light: 0xFFFFFF, dark: 0x0E1117)
    /// Text drawn on an ink-filled block (inverted label).
    static let onInk = dynamic(light: 0xF1F3F7, dark: 0x0E1117)

    // MARK: Spacing / shape

    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let gutter: CGFloat = 16
    }

    enum Radius {
        static let panel: CGFloat = 16
        static let field: CGFloat = 10
        static let tag: CGFloat = 8
    }

    // MARK: Type

    enum Typeface {
        static let screenTitle = Font.largeTitle.weight(.heavy)
        static let eyebrow = Font.footnote.weight(.semibold).monospacedDigit()
        static let sectionTitle = Font.subheadline.weight(.heavy)
        static let code = Font.system(.subheadline, design: .monospaced).weight(.semibold)
        static let codeSmall = Font.system(.caption, design: .monospaced).weight(.medium)
        /// Counts such as "4 堂": tabular digits without spacing out CJK text.
        static let count = Font.footnote.weight(.semibold).monospacedDigit()
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

enum Tone {
    case neutral
    case signal
    case go
    case busy
    case danger

    var color: Color {
        switch self {
        case .neutral:
            return Theme.inkSecondary
        case .signal:
            return Theme.signal
        case .go:
            return Theme.go
        case .busy:
            return Theme.busy
        case .danger:
            return Theme.danger
        }
    }
}

extension PlannerCourseCategory {
    /// Muted category hue used for stripes and tinted fills (never for body text).
    var themeColor: Color {
        switch self {
        case .compulsory:
            return Self.hue(light: 0x2F5BD3, dark: 0x7C9CFF)
        case .elective:
            return Self.hue(light: 0x5D6578, dark: 0xA3ABBA)
        case .chinese:
            return Self.hue(light: 0xB7791F, dark: 0xE9B35E)
        case .english:
            return Self.hue(light: 0x1F7FA6, dark: 0x6CC3E6)
        case .genEd:
            return Self.hue(light: 0x8A4FC4, dark: 0xC79AF2)
        case .pe:
            return Self.hue(light: 0x2F8F5B, dark: 0x6FD19C)
        case .social:
            return Self.hue(light: 0x9C8200, dark: 0xE3C94F)
        case .other:
            return Self.hue(light: 0x1E8A8A, dark: 0x5FCFCF)
        case .unclassified:
            return Self.hue(light: 0x6B7280, dark: 0x9CA3AF)
        }
    }

    private static func hue(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

/// zh-Hant-TW date strings with cached formatters.
enum TWDate {
    private static var cache: [String: DateFormatter] = [:]

    static func string(_ date: Date, _ format: String) -> String {
        if let formatter = cache[format] {
            return formatter.string(from: date)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.dateFormat = format
        cache[format] = formatter
        return formatter.string(from: date)
    }
}

// MARK: - Screen scaffolding

extension View {
    /// Canvas background for a top-level tab screen with the navigation bar hidden.
    func screenChrome() -> some View {
        self
            .background(Theme.canvas.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
    }

    /// Standard gutters for scroll content; bottom space clears the floating tab bar.
    func screenPadding() -> some View {
        self
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.top, Theme.Space.s)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
    }

    /// Card: white surface, soft corners, a barely-there shadow instead of a border.
    func panel(padding: CGFloat? = Theme.Space.l) -> some View {
        self
            .padding(padding ?? 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .fill(Theme.surface)
                    .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
            }
    }

    /// Text-field chrome matching the panel language.
    func fieldChrome() -> some View {
        self
            .padding(.horizontal, Theme.Space.m)
            .padding(.vertical, Theme.Space.m)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous)
                    .strokeBorder(Theme.rule, lineWidth: 1)
            )
    }
}

/// Screen title block: small eyebrow above a heavy large title.
struct ScreenHeader<Trailing: View>: View {
    let eyebrow: String?
    let title: String
    @ViewBuilder var trailing: () -> Trailing

    init(eyebrow: String?, title: String, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.eyebrow = eyebrow
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow)
                    .font(Theme.Typeface.eyebrow)
                    .foregroundStyle(Theme.inkSecondary)
            }
            HStack(alignment: .lastTextBaseline, spacing: Theme.Space.s) {
                Text(title)
                    .font(Theme.Typeface.screenTitle)
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                trailing()
            }
        }
        .padding(.top, Theme.Space.s)
    }
}

/// Table-style section heading: bold title, optional trailing accessory, hairline below.
struct SectionHeading<Accessory: View>: View {
    let title: String
    let caption: String?
    @ViewBuilder var accessory: () -> Accessory

    init(_ title: String, caption: String? = nil, @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }) {
        self.title = title
        self.caption = caption
        self.accessory = accessory
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(title)
                    .font(Theme.Typeface.sectionTitle)
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Theme.Space.s)
                accessory()
            }
            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            RuleLine()
                .padding(.top, 2)
        }
    }
}

struct RuleLine: View {
    var color: Color = Theme.rule

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

/// Small pill label; soft tint by default, solid fill for strong states.
struct Tag: View {
    let text: String
    var tone: Tone = .neutral
    var filled = false

    var body: some View {
        Text(text)
            .font(.caption.weight(.bold))
            .lineLimit(1)
            .foregroundStyle(filled ? Theme.onFill : tone.color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .padding(.horizontal, 2)
            .background {
                Capsule(style: .continuous)
                    .fill(filled ? tone.color : tone.color.opacity(0.12))
            }
            .fixedSize()
    }
}

/// Inline message on a soft tinted box; used for errors, notices and hints.
struct Callout: View {
    let text: String
    var tone: Tone = .neutral
    var systemImage: String?

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(.footnote)
                .foregroundStyle(tone == .neutral ? Theme.inkSecondary : tone.color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, Theme.Space.s)
        .padding(.horizontal, Theme.Space.m)
        .background(
            tone == .neutral ? Theme.sunken : tone.color.opacity(0.10),
            in: RoundedRectangle(cornerRadius: Theme.Radius.field + 2, style: .continuous)
        )
    }
}

/// Left-aligned empty state on a soft sunken card.
struct EmptyNote: View {
    let title: String
    let message: String
    var systemImage: String = "minus"

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(Theme.inkTertiary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.ink)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.l)
        .background(Theme.sunken.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Thin horizontal meter (decorative; the owning row carries the accessible value).
struct Meter: View {
    let value: Double
    let total: Double
    var tint: Color = Theme.signal

    var body: some View {
        GeometryReader { proxy in
            let fraction = total > 0 ? min(max(value / total, 0), 1) : 0
            ZStack(alignment: .leading) {
                Rectangle().fill(Theme.sunken)
                Rectangle()
                    .fill(tint)
                    .frame(width: proxy.size.width * fraction)
            }
        }
        .frame(height: 8)
        .clipShape(Capsule(style: .continuous))
        .accessibilityHidden(true)
    }
}

/// One graduation requirement: label, current / target in mono, meter, remaining.
struct RequirementRow: View {
    let title: String
    let current: Double
    let target: Double

    private var isDone: Bool { current >= target }
    private var remaining: Int { max(0, Int(target - current)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: Theme.Space.s)
                if isDone {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(Theme.go)
                } else if target > 0 {
                    Text("差 \(remaining)")
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                }
                Text("\(Int(current))")
                    .font(.system(.subheadline, design: .monospaced).weight(.bold))
                    .foregroundStyle(Theme.ink)
                + Text("/\(Int(target))")
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.inkSecondary)
            }
            Meter(value: current, total: max(target, 1), tint: isDone ? Theme.go : Theme.signal)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(isDone ? "已修 \(Int(current))，目標 \(Int(target))，已達成" : "已修 \(Int(current))，目標 \(Int(target))，還差 \(remaining)")
    }
}

/// Six squares for general-education dimensions A–F.
struct GenEdStrip: View {
    let completed: [PlannerGenEdDimension]

    private let dimensions: [PlannerGenEdDimension] = [.A, .B, .C, .D, .E, .F]

    var body: some View {
        HStack(spacing: Theme.Space.xs) {
            ForEach(dimensions, id: \.id) { dimension in
                let isDone = completed.contains(dimension)
                Text(dimension.rawValue)
                    .font(.system(.subheadline, design: .monospaced).weight(.heavy))
                    .foregroundStyle(isDone ? Theme.signal : Theme.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Space.s)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                            .fill(isDone ? Theme.signal.opacity(0.14) : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.tag, style: .continuous)
                            .strokeBorder(isDone ? Color.clear : Theme.rule, lineWidth: 1)
                    )
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("通識向度")
        .accessibilityValue(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        let done = dimensions.filter { completed.contains($0) }.map(\.rawValue)
        let missing = dimensions.filter { !completed.contains($0) }.map(\.rawValue)
        var parts: [String] = []
        parts.append(done.isEmpty ? "尚未修習任何向度" : "已修 \(done.joined(separator: "、"))")
        if !missing.isEmpty {
            parts.append("未修 \(missing.joined(separator: "、"))")
        }
        return parts.joined(separator: "，")
    }
}

/// Pulsing dot that marks something happening right now.
struct LiveDot: View {
    var color: Color = Theme.signal
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: "circle.fill")
            .font(.system(size: 8))
            .foregroundStyle(color)
            .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
            .accessibilityHidden(true)
    }
}

/// Collapsible section with a rotating chevron, exposed to VoiceOver as one button.
struct FoldSection<Content: View>: View {
    let title: String
    let caption: String?
    @Binding var isExpanded: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.25)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .center, spacing: Theme.Space.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(Theme.Typeface.sectionTitle)
                            .foregroundStyle(Theme.ink)
                        if let caption, !caption.isEmpty {
                            Text(caption)
                                .font(.caption)
                                .foregroundStyle(Theme.inkSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Theme.inkSecondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.vertical, Theme.Space.m)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isExpanded ? "已展開" : "已收合")
            .accessibilityHint(isExpanded ? "點兩下收合" : "點兩下展開")

            RuleLine()

            if isExpanded {
                content()
                    .padding(.top, Theme.Space.m)
                    .transition(.opacity)
            }
        }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var tone: Tone = .signal
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Theme.onFill)
            .frame(maxWidth: compact ? nil : .infinity)
            .padding(.horizontal, compact ? Theme.Space.l : Theme.Space.l)
            .padding(.vertical, compact ? Theme.Space.m : 14)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .fill(tone.color)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

struct OutlineButtonStyle: ButtonStyle {
    var tone: Tone = .neutral
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tone == .neutral ? Theme.ink : tone.color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.m)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .fill(configuration.isPressed ? Theme.sunken : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .strokeBorder(tone == .neutral ? Theme.ink : tone.color, lineWidth: 1.5)
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

/// Row-shaped button feedback (pressed tint only).
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? Theme.sunken : Color.clear)
    }
}
