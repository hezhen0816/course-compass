import SwiftUI

enum AppTab: String, CaseIterable, Hashable {
    case home
    case schedule
    case rooms
    case planner
    case settings

    var title: String {
        switch self {
        case .home:
            return "首頁"
        case .schedule:
            return "課表"
        case .rooms:
            return "空教室"
        case .planner:
            return "學分規劃"
        case .settings:
            return "設定"
        }
    }

    var systemImage: String {
        switch self {
        case .home:
            return "house.fill"
        case .schedule:
            return "calendar"
        case .rooms:
            return "door.left.hand.open"
        case .planner:
            return "chart.bar.doc.horizontal"
        case .settings:
            return "gearshape.fill"
        }
    }
}

enum Weekday: String, CaseIterable, Identifiable, Codable {
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
    case sunday

    var id: String { rawValue }

    var shortTitle: String {
        switch self {
        case .monday:
            return "一"
        case .tuesday:
            return "二"
        case .wednesday:
            return "三"
        case .thursday:
            return "四"
        case .friday:
            return "五"
        case .saturday:
            return "六"
        case .sunday:
            return "日"
        }
    }

    var fullTitle: String {
        "星期\(shortTitle)"
    }

    var calendarWeekday: Int {
        switch self {
        case .monday:
            return 2
        case .tuesday:
            return 3
        case .wednesday:
            return 4
        case .thursday:
            return 5
        case .friday:
            return 6
        case .saturday:
            return 7
        case .sunday:
            return 1
        }
    }

    static func currentWeekday(from date: Date = Date()) -> Weekday {
        let weekday = Calendar.current.component(.weekday, from: date)
        switch weekday {
        case 2:
            return .monday
        case 3:
            return .tuesday
        case 4:
            return .wednesday
        case 5:
            return .thursday
        case 6:
            return .friday
        case 7:
            return .saturday
        case 1:
            return .sunday
        default:
            return .monday
        }
    }
}

enum PlannerCourseCategory: String, CaseIterable, Identifiable, Codable {
    case compulsory
    case elective
    case chinese
    case english
    case genEd
    case pe
    case social
    case other
    case unclassified

    var id: String { rawValue }

    var title: String {
        switch self {
        case .compulsory:
            return "必修"
        case .elective:
            return "選修"
        case .chinese:
            return "國文"
        case .english:
            return "英文"
        case .genEd:
            return "通識"
        case .pe:
            return "體育"
        case .social:
            return "社會實踐"
        case .other:
            return "其他"
        case .unclassified:
            return "未歸類"
        }
    }

    var tint: Color {
        switch self {
        case .compulsory:
            return .red
        case .elective:
            return .blue
        case .chinese:
            return .orange
        case .english:
            return .indigo
        case .genEd:
            return .purple
        case .pe:
            return .green
        case .social:
            return .yellow
        case .other:
            return .teal
        case .unclassified:
            return .gray
        }
    }
}

enum PlannerCourseProgram: String, CaseIterable, Identifiable {
    case home
    case doubleMajor
    case minor
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home:
            return "本系"
        case .doubleMajor:
            return "雙主修"
        case .minor:
            return "輔修"
        case .other:
            return "其他"
        }
    }
}

enum PlannerGenEdDimension: String, CaseIterable, Identifiable {
    case A
    case B
    case C
    case D
    case E
    case F
    case none

    var id: String { rawValue }

    var title: String {
        switch self {
        case .A:
            return "A 人文素養"
        case .B:
            return "B 當代文明"
        case .C:
            return "C 美感與人生"
        case .D:
            return "D 社會歷史"
        case .E:
            return "E 群己制度"
        case .F:
            return "F 自然生命"
        case .none:
            return "未設定"
        }
    }
}

enum ScheduleSyncState: Equatable {
    case idle
    case syncing
    case synced
    case failed(String)

    var label: String {
        switch self {
        case .idle:
            return "尚未同步"
        case .syncing:
            return "同步中"
        case .synced:
            return "已同步"
        case .failed(let message):
            return message
        }
    }
}

enum AuthFormMode {
    case login
    case signup

    var title: String {
        switch self {
        case .login:
            return "登入"
        case .signup:
            return "建立帳號"
        }
    }

    var toggleTitle: String {
        switch self {
        case .login:
            return "沒有帳號？點此建立"
        case .signup:
            return "已有帳號？點此登入"
        }
    }
}

struct UpcomingCourse: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let timeLabel: String
    let slotTimes: [String]
    let room: String
    let weekday: Weekday
    let note: String

    var startTime: DateComponents {
        sessionTimeRanges.first?.start ?? parsedTimeRange(timeLabel, fallbackStartHour: 9, fallbackEndHour: 10).start
    }

    var endTime: DateComponents {
        sessionTimeRanges.last?.end ?? parsedTimeRange(timeLabel, fallbackStartHour: 9, fallbackEndHour: 10).end
    }

    func startDate(on referenceDate: Date, calendar: Calendar = .current) -> Date? {
        calendar.date(
            bySettingHour: startTime.hour ?? 9,
            minute: startTime.minute ?? 0,
            second: 0,
            of: referenceDate
        )
    }

    func endDate(on referenceDate: Date, calendar: Calendar = .current) -> Date? {
        calendar.date(
            bySettingHour: endTime.hour ?? 10,
            minute: endTime.minute ?? 0,
            second: 0,
            of: referenceDate
        )
    }

    func hasEnded(on referenceDate: Date, calendar: Calendar = .current) -> Bool {
        guard let endDate = endDate(on: referenceDate, calendar: calendar) else {
            return false
        }
        return endDate <= referenceDate
    }

    var sessionTimeRanges: [(start: DateComponents, end: DateComponents)] {
        let rawRanges = slotTimes.isEmpty ? [timeLabel] : slotTimes
        return rawRanges.map {
            parsedTimeRange($0, fallbackStartHour: 9, fallbackEndHour: 10)
        }
    }

    func countdownState(on referenceDate: Date, calendar: Calendar = .current) -> CountdownState? {
        var sessions: [(start: Date, end: Date)] = []
        for range in sessionTimeRanges {
            guard
                let start = calendar.date(
                    bySettingHour: range.start.hour ?? 9,
                    minute: range.start.minute ?? 0,
                    second: 0,
                    of: referenceDate
                ),
                let end = calendar.date(
                    bySettingHour: range.end.hour ?? 10,
                    minute: range.end.minute ?? 0,
                    second: 0,
                    of: referenceDate
                )
            else {
                continue
            }
            sessions.append((start: start, end: end))
        }

        guard let firstSession = sessions.first, let lastSession = sessions.last else {
            return nil
        }

        if referenceDate < firstSession.start {
            return .beforeClass(firstSession.start)
        }

        for (index, session) in sessions.enumerated() {
            if referenceDate < session.start {
                return .betweenSessions(session.start)
            }

            if referenceDate < session.end {
                if index < sessions.count - 1, let nextSession = sessions[safe: index + 1], referenceDate < nextSession.start {
                    return .inClass(session.end)
                }
                return .inClass(session.end)
            }

            if let nextSession = sessions[safe: index + 1], referenceDate < nextSession.start {
                return .betweenSessions(nextSession.start)
            }
        }

        if referenceDate < lastSession.end {
            return .inClass(lastSession.end)
        }

        return nil
    }

    private func parsedTimeRange(_ label: String, fallbackStartHour: Int, fallbackEndHour: Int) -> (start: DateComponents, end: DateComponents) {
        let matches = label.matches(of: /(\d{1,2}):(\d{2})/)
        if matches.count >= 2 {
            let start = matches[0]
            let end = matches[1]
            return (
                DateComponents(
                    hour: Int(start.output.1) ?? fallbackStartHour,
                    minute: Int(start.output.2) ?? 0
                ),
                DateComponents(
                    hour: Int(end.output.1) ?? fallbackEndHour,
                    minute: Int(end.output.2) ?? 0
                )
            )
        }

        let pieces = label
            .replacingOccurrences(of: "～", with: "-")
            .replacingOccurrences(of: "~", with: "-")
            .components(separatedBy: "-")
        let startLabel = pieces.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "\(fallbackStartHour):00"
        let endLabel = pieces.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "\(fallbackEndHour):00"
        return (
            parseSingleTime(startLabel, fallbackHour: fallbackStartHour),
            parseSingleTime(endLabel, fallbackHour: fallbackEndHour)
        )
    }

    private func parseSingleTime(_ label: String, fallbackHour: Int) -> DateComponents {
        if let match = label.firstMatch(of: /(\d{1,2}):(\d{2})/) {
            return DateComponents(
                hour: Int(match.output.1) ?? fallbackHour,
                minute: Int(match.output.2) ?? 0
            )
        }

        let parts = label.split(separator: ":")
        let hour = Int(parts.first ?? Substring("\(fallbackHour)")) ?? fallbackHour
        let minute = Int(parts.dropFirst().first ?? "0") ?? 0
        return DateComponents(hour: hour, minute: minute)
    }
}

enum CountdownState {
    case beforeClass(Date)
    case inClass(Date)
    case betweenSessions(Date)
}

struct ScheduleEntry: Identifiable, Codable {
    let id = UUID()
    let weekday: Weekday
    let title: String
    let timeRange: String
    let slotTimes: [String]
    let room: String
    let instructor: String
    let accent: PlannerCourseCategory

    enum CodingKeys: String, CodingKey {
        case weekday
        case title
        case timeRange
        case slotTimes
        case room
        case instructor
        case accent
    }

    init(
        weekday: Weekday,
        title: String,
        timeRange: String,
        slotTimes: [String] = [],
        room: String,
        instructor: String,
        accent: PlannerCourseCategory
    ) {
        self.weekday = weekday
        self.title = title
        self.timeRange = timeRange
        self.slotTimes = slotTimes
        self.room = room
        self.instructor = instructor
        self.accent = accent
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        weekday = try container.decode(Weekday.self, forKey: .weekday)
        title = try container.decode(String.self, forKey: .title)
        timeRange = try container.decode(String.self, forKey: .timeRange)
        slotTimes = try container.decodeIfPresent([String].self, forKey: .slotTimes) ?? []
        room = try container.decode(String.self, forKey: .room)
        instructor = try container.decode(String.self, forKey: .instructor)
        accent = try container.decode(PlannerCourseCategory.self, forKey: .accent)
    }
}

struct ScheduleSyncRequest: Encodable {
    let username: String
    let password: String
    let profileKey: String
    let persistToSupabase: Bool
    let verifySSL: Bool

    enum CodingKeys: String, CodingKey {
        case username
        case password
        case profileKey = "profile_key"
        case persistToSupabase = "persist_to_supabase"
        case verifySSL = "verify_ssl"
    }
}

struct HistoryImportRequest: Encodable {
    let username: String
    let password: String
    let profileKey: String
    let persistToSupabase: Bool
    let verifySSL: Bool

    enum CodingKeys: String, CodingKey {
        case username
        case password
        case profileKey = "profile_key"
        case persistToSupabase = "persist_to_supabase"
        case verifySSL = "verify_ssl"
    }
}

struct MoodleAssignmentsRequest: Encodable {
    let username: String
    let password: String
    let profileKey: String
    let persistToSupabase: Bool
    let verifySSL: Bool

    enum CodingKeys: String, CodingKey {
        case username
        case password
        case profileKey = "profile_key"
        case persistToSupabase = "persist_to_supabase"
        case verifySSL = "verify_ssl"
    }
}

struct ScheduleSyncResponse: Decodable {
    let profileKey: String
    let schoolAccount: String
    let studentName: String?
    let sourceURL: String
    let pageTitle: String
    let totalCreditsText: String
    let totalCredits: Double?
    let syncedAt: Date
    let courseCount: Int
    let scheduledSlotCount: Int
    let scheduleEntryCount: Int
    let persistedToSupabase: Bool
    let courses: [RemoteCourse]
    let scheduleEntries: [RemoteScheduleEntry]

    enum CodingKeys: String, CodingKey {
        case profileKey = "profile_key"
        case schoolAccount = "school_account"
        case studentName = "student_name"
        case sourceURL = "source_url"
        case pageTitle = "page_title"
        case totalCreditsText = "total_credits_text"
        case totalCredits = "total_credits"
        case syncedAt = "synced_at"
        case courseCount = "course_count"
        case scheduledSlotCount = "scheduled_slot_count"
        case scheduleEntryCount = "schedule_entry_count"
        case persistedToSupabase = "persisted_to_supabase"
        case courses
        case scheduleEntries = "schedule_entries"
    }
}

struct HistoryImportResponse: Decodable {
    let profileKey: String
    let schoolAccount: String
    let studentName: String?
    let studentNo: String?
    let department: String?
    let status: String?
    let sourceURL: String
    let pageTitle: String
    let importedAt: Date
    let recordCount: Int
    let persistedToSupabase: Bool
    let summaryTexts: [String]
    let records: [HistoryCourseRecord]

    enum CodingKeys: String, CodingKey {
        case profileKey = "profile_key"
        case schoolAccount = "school_account"
        case studentName = "student_name"
        case studentNo = "student_no"
        case department
        case status
        case sourceURL = "source_url"
        case pageTitle = "page_title"
        case importedAt = "imported_at"
        case recordCount = "record_count"
        case persistedToSupabase = "persisted_to_supabase"
        case summaryTexts = "summary_texts"
        case records
    }
}

struct MoodleAssignmentsResponse: Decodable {
    let profileKey: String
    let schoolAccount: String
    let sourceURL: String
    let pageTitle: String
    let timelineFilter: String
    let syncedAt: Date
    let itemCount: Int
    let persistedToSupabase: Bool
    let items: [MoodleAssignmentItem]

    enum CodingKeys: String, CodingKey {
        case profileKey = "profile_key"
        case schoolAccount = "school_account"
        case sourceURL = "source_url"
        case pageTitle = "page_title"
        case timelineFilter = "timeline_filter"
        case syncedAt = "synced_at"
        case itemCount = "item_count"
        case persistedToSupabase = "persisted_to_supabase"
        case items
    }
}

struct TRRoomMeeting: Identifiable, Decodable {
    let room: String
    let node: String
    let courseNo: String
    let courseName: String
    let teacher: String

    var id: String {
        "\(room)|\(node)|\(courseNo)|\(courseName)"
    }

    enum CodingKeys: String, CodingKey {
        case room
        case node
        case courseNo = "course_no"
        case courseName = "course_name"
        case teacher
    }
}

struct TRRoomStatusResponse: Decodable {
    let semester: String
    let queriedAt: Date
    let target: String
    let node: String?
    let nodeLabel: String
    let isClassTime: Bool
    let room: String?
    let roomIsFree: Bool?
    let roomMeetings: [TRRoomMeeting]
    let freeRooms: [String]
    let busyRooms: [String]
    let totalRooms: Int
    let note: String

    enum CodingKeys: String, CodingKey {
        case semester
        case queriedAt = "queried_at"
        case target
        case node
        case nodeLabel = "node_label"
        case isClassTime = "is_class_time"
        case room
        case roomIsFree = "room_is_free"
        case roomMeetings = "room_meetings"
        case freeRooms = "free_rooms"
        case busyRooms = "busy_rooms"
        case totalRooms = "total_rooms"
        case note
    }
}

struct HistoryCourseRecord: Decodable {
    let category: String
    let courseCode: String
    let courseName: String
    let academicTerm: String
    let grade: String
    let earnedCredits: String

    enum CodingKeys: String, CodingKey {
        case category
        case courseCode = "course_code"
        case courseName = "course_name"
        case academicTerm = "academic_term"
        case grade
        case earnedCredits = "earned_credits"
    }
}

struct MoodleAssignmentItem: Identifiable, Codable {
    let dueAt: Date
    let title: String
    let summary: String
    let courseName: String
    let actionLabel: String
    let actionURL: String
    let eventURL: String
    let overdue: Bool

    var id: String {
        "\(courseName)|\(title)|\(dueAt.timeIntervalSince1970)"
    }

    enum CodingKeys: String, CodingKey {
        case dueAt = "due_at"
        case title
        case summary
        case courseName = "course_name"
        case actionLabel = "action_label"
        case actionURL = "action_url"
        case eventURL = "event_url"
        case overdue
    }
}

struct RemoteCourse: Decodable {
    let courseCode: String
    let courseName: String
    let credits: Double?
    let requiredType: String
    let professor: String
    let note: String

    enum CodingKeys: String, CodingKey {
        case courseCode = "course_code"
        case courseName = "course_name"
        case credits
        case requiredType = "required_type"
        case professor
        case note
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        courseCode = try container.decode(String.self, forKey: .courseCode)
        courseName = try container.decode(String.self, forKey: .courseName)
        requiredType = try container.decode(String.self, forKey: .requiredType)
        professor = try container.decode(String.self, forKey: .professor)
        note = try container.decode(String.self, forKey: .note)

        if let number = try? container.decode(Double.self, forKey: .credits) {
            credits = number
        } else if let text = try? container.decode(String.self, forKey: .credits) {
            credits = Double(text)
        } else {
            credits = nil
        }
    }
}

struct RemoteScheduleEntry: Decodable {
    let weekdayKey: Weekday
    let title: String
    let timeRange: String
    let slotTimes: [String]
    let room: String
    let instructor: String
    let accent: String

    enum CodingKeys: String, CodingKey {
        case weekdayKey = "weekday_key"
        case title
        case timeRange = "time_range"
        case slotTimes = "slot_times"
        case room
        case instructor
        case accent
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        weekdayKey = try container.decode(Weekday.self, forKey: .weekdayKey)
        title = try container.decode(String.self, forKey: .title)
        timeRange = try container.decode(String.self, forKey: .timeRange)
        slotTimes = try container.decodeIfPresent([String].self, forKey: .slotTimes) ?? []
        room = try container.decode(String.self, forKey: .room)
        instructor = try container.decode(String.self, forKey: .instructor)
        accent = try container.decode(String.self, forKey: .accent)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

struct SupabaseAuthUser: Codable {
    let id: String
    let email: String?
}

struct SupabaseAuthSessionResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let expiresAt: TimeInterval?
    let expiresIn: Int?
    let tokenType: String?
    let user: SupabaseAuthUser?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
        case user
    }
}

struct SupabaseStoredSession: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userID: String
    let email: String?
}

struct SupabaseAuthErrorResponse: Decodable {
    let errorDescription: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case errorDescription = "error_description"
        case message
    }
}

struct CloudAppDataPayload: Codable {
    let semesters: [CloudSemester]?
    let targets: CloudTargets?
    let settings: CloudUserSettings?
}

struct CloudSemester: Codable {
    let id: String
    let name: String
    let courses: [CloudCourse]
}

struct CloudCourse: Codable {
    let id: String
    let name: String
    let credits: Double
    let category: String
    let program: String?
    let dimension: String?
    let details: CloudCourseDetails?
}

struct CloudCourseDetails: Codable {
    let professor: String?
    let email: String?
    let location: String?
    let time: String?
    let link: String?
    let gradingPolicy: [CloudGradingItem]
    let notes: String?
}

struct CloudGradingItem: Codable {
    let id: String
    let name: String
    let weight: Double
    let score: Double?
}

struct CloudTargets: Codable {
    let total: Double
    let chinese: Double
    let english: Double
    let genEd: Double
    let peSemesters: Double
    let social: Double
    let homeCompulsory: Double
    let homeElective: Double
    let doubleMajor: Double
    let minor: Double

    enum CodingKeys: String, CodingKey {
        case total
        case chinese
        case english
        case genEd = "gen_ed"
        case peSemesters = "pe_semesters"
        case social
        case homeCompulsory = "home_compulsory"
        case homeElective = "home_elective"
        case doubleMajor = "double_major"
        case minor
    }
}

struct CloudUserSettings: Codable {
    let schoolAccount: String?
    let schoolPassword: String?
    let reminderMinutes: Int?

    enum CodingKeys: String, CodingKey {
        case schoolAccount = "school_account"
        case schoolPassword = "school_password"
        case reminderMinutes = "reminder_minutes"
    }
}

struct CloudUserDataRecord: Decodable {
    let content: CloudAppDataPayload
}

struct PlannerCourse: Identifiable, Equatable {
    var id = UUID()
    var name: String
    var credits: Double
    var category: PlannerCourseCategory
    var program: PlannerCourseProgram
    var dimension: PlannerGenEdDimension = .none
    var instructor: String = ""
    var location: String = ""
    var time: String = ""
    var notes: String = ""
}

struct PlannerSemester: Identifiable, Equatable {
    let id: UUID
    var name: String
    var courses: [PlannerCourse]

    init(id: UUID = UUID(), name: String, courses: [PlannerCourse]) {
        self.id = id
        self.name = name
        self.courses = courses
    }
}

struct PlannerTarget: Equatable {
    var total: Double
    var chinese: Double
    var english: Double
    var genEd: Double
    var peSemesters: Double
    var social: Double
    var homeCompulsory: Double
    var homeElective: Double
    var doubleMajor: Double
    var minor: Double

    static let `default` = PlannerTarget(
        total: 133,
        chinese: 3,
        english: 12,
        genEd: 16,
        peSemesters: 6,
        social: 1,
        homeCompulsory: 72,
        homeElective: 24,
        doubleMajor: 0,
        minor: 0
    )
}

struct PlannerProgress {
    var total: Double = 0
    var chinese: Double = 0
    var english: Double = 0
    var genEd: Double = 0
    var peSemesters: Double = 0
    var social: Double = 0
    var homeCompulsory: Double = 0
    var homeElective: Double = 0
    var doubleMajor: Double = 0
    var minor: Double = 0
    var genEdDimensions: Set<PlannerGenEdDimension> = []

    static func calculate(from semesters: [PlannerSemester]) -> PlannerProgress {
        var progress = PlannerProgress()

        for semester in semesters {
            var hasPE = false

            for course in semester.courses {
                let credits = course.credits

                if course.category == .pe {
                    hasPE = true
                    continue
                }

                if course.category == .social {
                    progress.social += 1
                    continue
                }

                progress.total += credits

                switch course.category {
                case .chinese:
                    progress.chinese += credits
                case .english:
                    progress.english += credits
                case .genEd:
                    progress.genEd += credits
                    if course.dimension != .none {
                        progress.genEdDimensions.insert(course.dimension)
                    }
                case .compulsory where course.program == .home:
                    progress.homeCompulsory += credits
                case .elective where course.program == .home:
                    progress.homeElective += credits
                default:
                    break
                }

                switch course.program {
                case .doubleMajor:
                    progress.doubleMajor += credits
                case .minor:
                    progress.minor += credits
                default:
                    break
                }
            }

            if hasPE {
                progress.peSemesters += 1
            }
        }

        return progress
    }
}

struct InfoMessage: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}
