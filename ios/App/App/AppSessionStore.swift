import Security
import SwiftUI

private struct UserDataUpsertRequest: Encodable {
    let userID: String
    let content: CloudAppDataPayload
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case content
        case updatedAt = "updated_at"
    }
}

@MainActor
final class AppSessionStore: ObservableObject {
    @Published var selectedTab: AppTab = .home
    @Published var schoolAccount: String = "" {
        didSet {
            guard !isRestoringPersistedState else { return }
            persistLocalPreferences()
            queuePlannerSave()
        }
    }
    @Published var schoolPassword: String = "" {
        didSet {
            guard !isRestoringPersistedState else { return }
            persistSchoolPassword()
        }
    }
    @Published var backendBaseURL: String = "http://127.0.0.1:8000" {
        didSet {
            guard !isRestoringPersistedState else { return }
            persistLocalPreferences()
            queuePlannerSave()
        }
    }
    @Published var reminderMinutes: Int = 10 {
        didSet {
            guard !isRestoringPersistedState else { return }
            persistLocalPreferences()
        }
    }
    @Published var syncState: ScheduleSyncState = .idle
    @Published var lastSyncedAt: Date?
    @Published var plannerTargets: PlannerTarget = .default
    @Published var plannerSemesters: [PlannerSemester] = []
    @Published var studentName: String = ""
    @Published var subtitle: String = "資料展示模式"
    @Published var upcomingCourses: [UpcomingCourse]
    @Published var todoItems: [TodoItem]
    @Published var scheduleEntries: [ScheduleEntry]
    @Published var currentUserEmail: String?
    @Published var isRestoringSession = true
    @Published var isAuthenticating = false
    @Published var authErrorMessage: String?
    @Published var authNoticeMessage: String?

    private var authSession: SupabaseStoredSession?
    private var plannerSaveTask: Task<Void, Never>?
    private var isRestoringPersistedState = false

    init() {
        let persistedScheduleSnapshot = Self.loadPersistedScheduleSnapshot()
        self.upcomingCourses = persistedScheduleSnapshot.map {
            Self.buildUpcomingCourses(from: $0.scheduleEntries)
        } ?? Self.demoUpcomingCourses()
        self.todoItems = Self.demoTodoItems()
        self.scheduleEntries = persistedScheduleSnapshot?.scheduleEntries ?? Self.demoScheduleEntries()
        self.plannerSemesters = Self.demoPlannerSemesters()
        self.studentName = persistedScheduleSnapshot?.studentName ?? ""
        self.subtitle = persistedScheduleSnapshot?.subtitle ?? "資料展示模式"
        self.lastSyncedAt = persistedScheduleSnapshot?.lastSyncedAt
        restoreLocalPreferences()

        Task {
            await restoreAuthSession()
        }
    }

    var isAuthenticated: Bool {
        authSession != nil
    }

    var isAuthConfigured: Bool {
        supabaseURL != nil && supabaseAnonKey != nil
    }

    var nextUpcomingCourse: UpcomingCourse? {
        todayUpcomingCourses.first
    }

    var orderedUpcomingCourses: [UpcomingCourse] {
        let referenceDate = Date()
        return upcomingCourses.sorted {
            nextOccurrenceDate(for: $0, from: referenceDate) < nextOccurrenceDate(for: $1, from: referenceDate)
        }
    }

    var todayUpcomingCourses: [UpcomingCourse] {
        let now = Date()
        let today = Weekday.currentWeekday(from: now)
        return upcomingCourses
            .filter { $0.weekday == today && !$0.hasEnded(on: now) }
            .sorted { lhs, rhs in
                let lhsStart = lhs.startDate(on: now) ?? now
                let rhsStart = rhs.startDate(on: now) ?? now
                return lhsStart < rhsStart
            }
    }

    var displayName: String {
        let trimmedName = studentName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty {
            return trimmedName
        }

        if let currentUserEmail, !currentUserEmail.isEmpty {
            return currentUserEmail
        }

        let trimmedAccount = schoolAccount.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedAccount.isEmpty {
            return trimmedAccount
        }

        return "未設定使用者"
    }

    var plannerProgress: PlannerProgress {
        PlannerProgress.calculate(from: plannerSemesters)
    }

    func credits(for semester: PlannerSemester) -> Double {
        semester.courses.reduce(0) { partialResult, course in
            if course.category == .pe {
                return partialResult
            }
            return partialResult + course.credits
        }
    }

    func addCourse(_ course: PlannerCourse, to semesterID: PlannerSemester.ID) {
        guard let index = plannerSemesters.firstIndex(where: { $0.id == semesterID }) else {
            return
        }
        plannerSemesters[index].courses.append(course)
        queuePlannerSave()
    }

    func updateCourse(_ course: PlannerCourse, in semesterID: PlannerSemester.ID) {
        guard let semesterIndex = plannerSemesters.firstIndex(where: { $0.id == semesterID }) else {
            return
        }
        guard let courseIndex = plannerSemesters[semesterIndex].courses.firstIndex(where: { $0.id == course.id }) else {
            return
        }
        plannerSemesters[semesterIndex].courses[courseIndex] = course
        queuePlannerSave()
    }

    func updateTargets(_ targets: PlannerTarget) {
        plannerTargets = targets
        queuePlannerSave()
    }

    func signIn(email: String, password: String) async {
        guard isAuthConfigured else {
            authErrorMessage = "尚未完成雲端登入設定"
            return
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            authErrorMessage = "請輸入 Email 與密碼"
            return
        }

        isAuthenticating = true
        authErrorMessage = nil
        authNoticeMessage = nil

        do {
            let endpoint = try makeURL(path: "/auth/v1/token?grant_type=password")
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyAPIHeaders(to: &request)
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": normalizedEmail,
                "password": password
            ])

            let payload: SupabaseAuthSessionResponse = try await performJSONRequest(request)
            try await establishAuthenticatedSession(from: payload, fallbackEmail: normalizedEmail)
        } catch {
            authErrorMessage = error.localizedDescription
        }

        isAuthenticating = false
    }

    func signUp(email: String, password: String) async {
        guard isAuthConfigured else {
            authErrorMessage = "尚未完成雲端登入設定"
            return
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            authErrorMessage = "請輸入 Email 與密碼"
            return
        }

        isAuthenticating = true
        authErrorMessage = nil
        authNoticeMessage = nil

        do {
            let endpoint = try makeURL(path: "/auth/v1/signup")
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyAPIHeaders(to: &request)
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": normalizedEmail,
                "password": password
            ])

            let payload: SupabaseAuthSessionResponse = try await performJSONRequest(request)
            if payload.accessToken != nil {
                try await establishAuthenticatedSession(from: payload, fallbackEmail: normalizedEmail)
                authNoticeMessage = "註冊成功，已直接登入"
            } else {
                authNoticeMessage = "註冊成功，請先完成信箱驗證後再登入"
            }
        } catch {
            authErrorMessage = error.localizedDescription
        }

        isAuthenticating = false
    }

    func signOut() async {
        plannerSaveTask?.cancel()

        if authSession != nil {
            do {
                let session = try await validSession(forceRefresh: false)
                let endpoint = try makeURL(path: "/auth/v1/logout")
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                applyAPIHeaders(to: &request)
                request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
                _ = try await URLSession.shared.data(for: request)
            } catch {
                // Ignore remote logout failures and clear the local session anyway.
            }
        }

        clearAuthenticatedState()
    }

    func syncSchedule() async {
        let username = schoolAccount.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = schoolPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseURL = normalizedBackendBaseURL

        guard !username.isEmpty, !password.isEmpty else {
            syncState = .failed("請先輸入學校帳號與密碼")
            return
        }

        guard let endpoint = URL(string: "\(baseURL)/api/schedule/sync") else {
            syncState = .failed("後端網址格式錯誤")
            return
        }

        syncState = .syncing

        do {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(
                ScheduleSyncRequest(
                    username: username,
                    password: password,
                    profileKey: username,
                    persistToSupabase: true,
                    verifySSL: false
                )
            )

            let (data, response) = try await URLSession.shared.data(for: request)
            try validateHTTPResponse(response, data: data)

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let payload = try decoder.decode(ScheduleSyncResponse.self, from: data)
            apply(payload: payload)
            syncState = .synced
        } catch {
            syncState = .failed(error.localizedDescription)
        }
    }

    func loadLatestScheduleSnapshot(suppressErrors: Bool = false) async {
        let profileKey = schoolAccount.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseURL = normalizedBackendBaseURL

        guard !profileKey.isEmpty else {
            if !suppressErrors {
                syncState = .failed("缺少學號，無法更新課表")
            }
            return
        }

        guard let endpoint = URL(string: "\(baseURL)/api/schedule/\(profileKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? profileKey)") else {
            if !suppressErrors {
                syncState = .failed("後端網址格式錯誤")
            }
            return
        }

        if !suppressErrors {
            syncState = .syncing
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: endpoint)
            try validateHTTPResponse(response, data: data)

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let payload = try decoder.decode(ScheduleSyncResponse.self, from: data)
            apply(payload: payload)
            syncState = .synced
        } catch {
            if !suppressErrors {
                syncState = .failed(error.localizedDescription)
            }
        }
    }

    private func restoreAuthSession() async {
        guard isAuthConfigured else {
            authErrorMessage = "尚未完成雲端登入設定"
            isRestoringSession = false
            return
        }

        defer {
            isRestoringSession = false
        }

        guard
            let sessionData = UserDefaults.standard.data(forKey: Self.authSessionStorageKey),
            let storedSession = try? JSONDecoder().decode(SupabaseStoredSession.self, from: sessionData)
        else {
            return
        }

        authSession = storedSession
        currentUserEmail = storedSession.email

        do {
            _ = try await validSession(forceRefresh: storedSession.expiresAt <= Date().addingTimeInterval(60))
            await loadPlannerData()
            await loadLatestScheduleSnapshot(suppressErrors: true)
        } catch {
            clearAuthenticatedState()
            authErrorMessage = "登入已失效，請重新登入"
        }
    }

    private func establishAuthenticatedSession(from payload: SupabaseAuthSessionResponse, fallbackEmail: String) async throws {
        guard
            let accessToken = payload.accessToken,
            let refreshToken = payload.refreshToken,
            let user = payload.user
        else {
            throw NSError(domain: "CoursePlannerAuth", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "雲端登入沒有回傳可用的 session"
            ])
        }

        let expiresAt: Date
        if let epoch = payload.expiresAt {
            expiresAt = Date(timeIntervalSince1970: epoch)
        } else if let expiresIn = payload.expiresIn {
            expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        } else {
            expiresAt = Date().addingTimeInterval(3600)
        }

        let storedSession = SupabaseStoredSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            userID: user.id,
            email: user.email ?? fallbackEmail
        )

        authSession = storedSession
        currentUserEmail = storedSession.email
        authErrorMessage = nil
        subtitle = "已登入帳號"
        persistAuthSession(storedSession)
        await loadPlannerData()
    }

    private func loadPlannerData() async {
        guard isAuthenticated else {
            return
        }

        do {
            let session = try await validSession()
            let queryUserID = session.userID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? session.userID
            let endpoint = try makeURL(path: "/rest/v1/user_data?select=content&user_id=eq.\(queryUserID)")
            var request = URLRequest(url: endpoint)
            request.httpMethod = "GET"
            applyAPIHeaders(to: &request)
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")

            let (data, response) = try await URLSession.shared.data(for: request)
            try validateHTTPResponse(response, data: data)

            let decoder = JSONDecoder()
            let records = try decoder.decode([CloudUserDataRecord].self, from: data)
            if let record = records.first {
                applyPlannerPayload(record.content)
                authNoticeMessage = "已載入雲端規劃資料"
            } else {
                plannerTargets = .default
                plannerSemesters = Self.blankPlannerSemesters()
                authNoticeMessage = "已登入帳號，可以開始建立你的規劃"
            }
        } catch {
            plannerTargets = .default
            plannerSemesters = Self.blankPlannerSemesters()
            authErrorMessage = "讀取雲端資料失敗：\(error.localizedDescription)"
        }
    }

    private func queuePlannerSave() {
        guard isAuthenticated else {
            return
        }

        plannerSaveTask?.cancel()
        plannerSaveTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else {
                return
            }
            await savePlannerData()
        }
    }

    private func savePlannerData() async {
        guard isAuthenticated else {
            return
        }

        do {
            let session = try await validSession()
            let endpoint = try makeURL(path: "/rest/v1/user_data?on_conflict=user_id")
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
            applyAPIHeaders(to: &request)
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")

            let payload = cloudAppDataPayload()
            let body = [
                UserDataUpsertRequest(
                    userID: session.userID,
                    content: payload,
                    updatedAt: Self.iso8601String(from: Date())
                )
            ]
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.withoutEscapingSlashes]
            request.httpBody = try encoder.encode(body)

            let (data, response) = try await URLSession.shared.data(for: request)
            try validateHTTPResponse(response, data: data)
            authNoticeMessage = "規劃資料已保存到雲端"
        } catch {
            authErrorMessage = "保存雲端資料失敗：\(error.localizedDescription)"
        }
    }

    private func validSession(forceRefresh: Bool = false) async throws -> SupabaseStoredSession {
        guard let currentSession = authSession else {
            throw NSError(domain: "CoursePlannerAuth", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "尚未登入"
            ])
        }

        if forceRefresh || currentSession.expiresAt <= Date().addingTimeInterval(60) {
            return try await refreshSession(using: currentSession)
        }

        return currentSession
    }

    private func refreshSession(using currentSession: SupabaseStoredSession) async throws -> SupabaseStoredSession {
        let endpoint = try makeURL(path: "/auth/v1/token?grant_type=refresh_token")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAPIHeaders(to: &request)
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "refresh_token": currentSession.refreshToken
        ])

        let payload: SupabaseAuthSessionResponse = try await performJSONRequest(request)
        guard
            let accessToken = payload.accessToken,
            let refreshToken = payload.refreshToken
        else {
            throw NSError(domain: "CoursePlannerAuth", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "無法刷新登入 session"
            ])
        }

        let expiresAt: Date
        if let epoch = payload.expiresAt {
            expiresAt = Date(timeIntervalSince1970: epoch)
        } else if let expiresIn = payload.expiresIn {
            expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        } else {
            expiresAt = Date().addingTimeInterval(3600)
        }

        let refreshedSession = SupabaseStoredSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            userID: payload.user?.id ?? currentSession.userID,
            email: payload.user?.email ?? currentSession.email
        )

        authSession = refreshedSession
        currentUserEmail = refreshedSession.email
        persistAuthSession(refreshedSession)
        return refreshedSession
    }

    private func cloudAppDataPayload() -> CloudAppDataPayload {
        CloudAppDataPayload(
            semesters: plannerSemesters.map { semester in
                CloudSemester(
                    id: semester.id.uuidString,
                    name: semester.name,
                    courses: semester.courses.map { course in
                        CloudCourse(
                            id: course.id.uuidString,
                            name: course.name,
                            credits: course.credits,
                            category: cloudCategory(for: course.category),
                            program: cloudProgram(for: course.program),
                            dimension: cloudDimension(for: course.dimension),
                            details: CloudCourseDetails(
                                professor: course.instructor.isEmpty ? nil : course.instructor,
                                email: nil,
                                location: course.location.isEmpty ? nil : course.location,
                                time: course.time.isEmpty ? nil : course.time,
                                link: nil,
                                gradingPolicy: [],
                                notes: course.notes.isEmpty ? nil : course.notes
                            )
                        )
                    }
                )
            },
            targets: CloudTargets(
                total: plannerTargets.total,
                chinese: plannerTargets.chinese,
                english: plannerTargets.english,
                genEd: plannerTargets.genEd,
                peSemesters: plannerTargets.peSemesters,
                social: plannerTargets.social,
                homeCompulsory: plannerTargets.homeCompulsory,
                homeElective: plannerTargets.homeElective,
                doubleMajor: plannerTargets.doubleMajor,
                minor: plannerTargets.minor
            ),
            settings: CloudUserSettings(
                schoolAccount: schoolAccount.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                backendBaseURL: backendBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            )
        )
    }

    private func applyPlannerPayload(_ payload: CloudAppDataPayload) {
        applyCloudSettings(payload.settings)

        let targets = payload.targets
        plannerTargets = PlannerTarget(
            total: targets?.total ?? PlannerTarget.default.total,
            chinese: targets?.chinese ?? PlannerTarget.default.chinese,
            english: targets?.english ?? PlannerTarget.default.english,
            genEd: targets?.genEd ?? PlannerTarget.default.genEd,
            peSemesters: targets?.peSemesters ?? PlannerTarget.default.peSemesters,
            social: targets?.social ?? PlannerTarget.default.social,
            homeCompulsory: targets?.homeCompulsory ?? PlannerTarget.default.homeCompulsory,
            homeElective: targets?.homeElective ?? PlannerTarget.default.homeElective,
            doubleMajor: targets?.doubleMajor ?? PlannerTarget.default.doubleMajor,
            minor: targets?.minor ?? PlannerTarget.default.minor
        )

        let semesters = (payload.semesters ?? []).map { semester in
            PlannerSemester(
                id: UUID(uuidString: semester.id) ?? UUID(),
                name: semester.name,
                courses: semester.courses.map { course in
                    PlannerCourse(
                        id: UUID(uuidString: course.id) ?? UUID(),
                        name: course.name,
                        credits: course.credits,
                        category: plannerCategory(from: course.category),
                        program: plannerProgram(from: course.program),
                        dimension: plannerDimension(from: course.dimension),
                        instructor: course.details?.professor ?? "",
                        location: course.details?.location ?? "",
                        time: course.details?.time ?? "",
                        notes: course.details?.notes ?? ""
                    )
                }
            )
        }

        plannerSemesters = semesters.isEmpty ? Self.blankPlannerSemesters() : semesters
    }

    private func applyCloudSettings(_ settings: CloudUserSettings?) {
        guard let settings else {
            return
        }

        isRestoringPersistedState = true
        if let schoolAccount = settings.schoolAccount?.trimmingCharacters(in: .whitespacesAndNewlines), !schoolAccount.isEmpty {
            self.schoolAccount = schoolAccount
        }
        if let backendBaseURL = settings.backendBaseURL?.trimmingCharacters(in: .whitespacesAndNewlines), !backendBaseURL.isEmpty {
            self.backendBaseURL = backendBaseURL
        }
        isRestoringPersistedState = false
        persistLocalPreferences()
    }

    private func apply(payload: ScheduleSyncResponse) {
        if let payloadStudentName = payload.studentName?.trimmingCharacters(in: .whitespacesAndNewlines), !payloadStudentName.isEmpty {
            studentName = payloadStudentName
        }
        subtitle = payload.persistedToSupabase ? "已同步並保存到雲端" : "已同步，但尚未保存到雲端"
        lastSyncedAt = payload.syncedAt
        scheduleEntries = payload.scheduleEntries.map { entry in
            ScheduleEntry(
                weekday: entry.weekdayKey,
                title: entry.title,
                timeRange: entry.timeRange,
                room: entry.room,
                instructor: entry.instructor,
                accent: mapAccent(entry.accent)
            )
        }
        upcomingCourses = Self.buildUpcomingCourses(from: scheduleEntries)
        persistScheduleSnapshot()
    }

    private static func buildUpcomingCourses(from entries: [ScheduleEntry]) -> [UpcomingCourse] {
        entries.map { entry in
            UpcomingCourse(
                title: entry.title,
                subtitle: entry.instructor.isEmpty ? "已同步課表" : entry.instructor,
                timeLabel: entry.timeRange,
                room: entry.room.isEmpty ? "未提供地點" : entry.room,
                weekday: entry.weekday,
                note: entry.room.isEmpty ? "此課程未提供教室資訊" : "同步自校務課表"
            )
        }
    }

    private func mapAccent(_ rawValue: String) -> PlannerCourseCategory {
        PlannerCourseCategory(rawValue: rawValue) ?? .unclassified
    }

    private func cloudCategory(for category: PlannerCourseCategory) -> String {
        switch category {
        case .genEd:
            return "gen_ed"
        default:
            return category.rawValue
        }
    }

    private func plannerCategory(from rawValue: String) -> PlannerCourseCategory {
        switch rawValue {
        case "gen_ed":
            return .genEd
        default:
            return PlannerCourseCategory(rawValue: rawValue) ?? .unclassified
        }
    }

    private func cloudProgram(for program: PlannerCourseProgram) -> String {
        switch program {
        case .doubleMajor:
            return "double_major"
        default:
            return program.rawValue
        }
    }

    private func plannerProgram(from rawValue: String?) -> PlannerCourseProgram {
        switch rawValue {
        case "double_major":
            return .doubleMajor
        case "minor":
            return .minor
        case "other":
            return .other
        default:
            return .home
        }
    }

    private func cloudDimension(for dimension: PlannerGenEdDimension) -> String? {
        dimension == .none ? "None" : dimension.rawValue
    }

    private func plannerDimension(from rawValue: String?) -> PlannerGenEdDimension {
        guard let rawValue, rawValue != "None" else {
            return .none
        }
        return PlannerGenEdDimension(rawValue: rawValue) ?? .none
    }

    private func restoreLocalPreferences() {
        isRestoringPersistedState = true

        if
            let data = UserDefaults.standard.data(forKey: Self.preferencesStorageKey),
            let preferences = try? JSONDecoder().decode(PersistedAppPreferences.self, from: data)
        {
            schoolAccount = preferences.schoolAccount
            backendBaseURL = preferences.backendBaseURL
            reminderMinutes = preferences.reminderMinutes
        } else {
            schoolAccount = "B11209001"
            backendBaseURL = "http://127.0.0.1:8000"
            reminderMinutes = 10
        }

        schoolPassword = loadSchoolPassword() ?? "courseplanner"
        isRestoringPersistedState = false
    }

    private func persistLocalPreferences() {
        let preferences = PersistedAppPreferences(
            schoolAccount: schoolAccount,
            backendBaseURL: backendBaseURL,
            reminderMinutes: reminderMinutes
        )

        if let data = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(data, forKey: Self.preferencesStorageKey)
        }
    }

    private func persistScheduleSnapshot() {
        let snapshot = PersistedScheduleSnapshot(
            studentName: studentName,
            subtitle: subtitle,
            lastSyncedAt: lastSyncedAt,
            scheduleEntries: scheduleEntries
        )

        if let data = try? JSONEncoder().encode(snapshot) {
            UserDefaults.standard.set(data, forKey: Self.scheduleSnapshotStorageKey)
        }
    }

    private static func loadPersistedScheduleSnapshot() -> PersistedScheduleSnapshot? {
        guard
            let data = UserDefaults.standard.data(forKey: scheduleSnapshotStorageKey),
            let snapshot = try? JSONDecoder().decode(PersistedScheduleSnapshot.self, from: data)
        else {
            return nil
        }
        return snapshot
    }

    private func persistSchoolPassword() {
        let trimmedPassword = schoolPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedPassword.isEmpty {
            deleteSchoolPassword()
            return
        }

        guard let passwordData = trimmedPassword.data(using: .utf8) else {
            return
        }

        let query = Self.schoolPasswordKeychainQuery()
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = passwordData
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private func loadSchoolPassword() -> String? {
        var query = Self.schoolPasswordKeychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard
            status == errSecSuccess,
            let data = result as? Data,
            let password = String(data: data, encoding: .utf8)
        else {
            return nil
        }

        return password
    }

    private func deleteSchoolPassword() {
        let query = Self.schoolPasswordKeychainQuery()
        SecItemDelete(query as CFDictionary)
    }

    private func persistAuthSession(_ session: SupabaseStoredSession) {
        if let encoded = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(encoded, forKey: Self.authSessionStorageKey)
        }
    }

    private func clearAuthenticatedState() {
        authSession = nil
        currentUserEmail = nil
        studentName = ""
        authErrorMessage = nil
        authNoticeMessage = nil
        subtitle = "資料展示模式"
        plannerTargets = .default
        plannerSemesters = Self.blankPlannerSemesters()
        UserDefaults.standard.removeObject(forKey: Self.authSessionStorageKey)
    }

    private func makeURL(path: String) throws -> URL {
        guard
            let supabaseURL,
            let url = URL(string: path, relativeTo: supabaseURL)
        else {
            throw NSError(domain: "CoursePlannerAuth", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "雲端服務網址設定錯誤"
            ])
        }
        return url
    }

    private func applyAPIHeaders(to request: inout URLRequest) {
        guard let supabaseAnonKey else {
            return
        }

        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    private func performJSONRequest<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response, data: data)

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    private func validateHTTPResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            if
                let authError = try? JSONDecoder().decode(SupabaseAuthErrorResponse.self, from: data),
                let message = authError.errorDescription ?? authError.message
            {
                throw NSError(domain: "CoursePlannerAuth", code: httpResponse.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: message
                ])
            }

            if
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let detail = json["detail"] as? String
            {
                throw NSError(domain: "CoursePlannerAuth", code: httpResponse.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: detail
                ])
            }

            throw NSError(domain: "CoursePlannerAuth", code: httpResponse.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "請求失敗，HTTP \(httpResponse.statusCode)"
            ])
        }
    }

    private func nextOccurrenceDate(for course: UpcomingCourse, from referenceDate: Date) -> Date {
        let calendar = Calendar(identifier: .gregorian)
        var components = DateComponents()
        components.weekday = course.weekday.calendarWeekday
        components.hour = course.startTime.hour
        components.minute = course.startTime.minute

        return calendar.nextDate(
            after: referenceDate.addingTimeInterval(-1),
            matching: components,
            matchingPolicy: .nextTimePreservingSmallerComponents,
            direction: .forward
        ) ?? referenceDate
    }

    private var normalizedBackendBaseURL: String {
        backendBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private var supabaseURL: URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String else {
            return nil
        }
        return URL(string: rawValue)
    }

    private var supabaseAnonKey: String? {
        Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String
    }

    private static let authSessionStorageKey = "courseplanner.supabase.session"
    private static let preferencesStorageKey = "courseplanner.preferences"
    private static let scheduleSnapshotStorageKey = "courseplanner.scheduleSnapshot"

    private static func schoolPasswordKeychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.hezhen.courseplanner.school",
            kSecAttrAccount as String: "schoolPassword"
        ]
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func blankPlannerSemesters() -> [PlannerSemester] {
        [
            PlannerSemester(name: "大一上", courses: []),
            PlannerSemester(name: "大一下", courses: []),
            PlannerSemester(name: "大二上", courses: []),
            PlannerSemester(name: "大二下", courses: []),
            PlannerSemester(name: "大三上", courses: []),
            PlannerSemester(name: "大三下", courses: []),
            PlannerSemester(name: "大四上", courses: []),
            PlannerSemester(name: "大四下", courses: [])
        ]
    }

    private static func demoUpcomingCourses() -> [UpcomingCourse] {
        [
            UpcomingCourse(
                title: "人機互動設計",
                subtitle: "今日第一堂課",
                timeLabel: "09:10 - 12:00",
                room: "TR-512",
                weekday: .monday,
                note: "課前帶上分組 wireframe 草稿"
            ),
            UpcomingCourse(
                title: "資料庫系統",
                subtitle: "期中專案進度確認",
                timeLabel: "13:20 - 16:10",
                room: "RB-105",
                weekday: .tuesday,
                note: "準備 schema 關聯圖與 SQL demo"
            ),
            UpcomingCourse(
                title: "數位產品企劃",
                subtitle: "提案彩排",
                timeLabel: "10:20 - 12:10",
                room: "IB-302",
                weekday: .thursday,
                note: "10 分鐘內完成 pitch"
            )
        ]
    }

    private static func demoTodoItems() -> [TodoItem] {
        [
            TodoItem(
                title: "完成期中簡報首頁與資訊架構圖",
                course: "數位產品企劃",
                dueLabel: "今天 18:00 前",
                priority: "高",
                isCompleted: false
            ),
            TodoItem(
                title: "上傳 Lab 2 程式與測試截圖",
                course: "資料庫系統",
                dueLabel: "明天 23:59 前",
                priority: "中",
                isCompleted: false
            ),
            TodoItem(
                title: "閱讀 HCI 第 6 章並整理筆記",
                course: "人機互動設計",
                dueLabel: "本週五前",
                priority: "低",
                isCompleted: true
            )
        ]
    }

    private static func demoScheduleEntries() -> [ScheduleEntry] {
        [
            ScheduleEntry(weekday: .monday, title: "人機互動設計", timeRange: "09:10 - 12:00", room: "TR-512", instructor: "王怡文", accent: .compulsory),
            ScheduleEntry(weekday: .monday, title: "通識：科技與社會", timeRange: "13:20 - 15:10", room: "AU-101", instructor: "陳明志", accent: .genEd),
            ScheduleEntry(weekday: .tuesday, title: "資料庫系統", timeRange: "13:20 - 16:10", room: "RB-105", instructor: "林大鈞", accent: .compulsory),
            ScheduleEntry(weekday: .wednesday, title: "英文簡報與溝通", timeRange: "10:20 - 12:10", room: "IB-201", instructor: "Jessica Wu", accent: .english),
            ScheduleEntry(weekday: .thursday, title: "數位產品企劃", timeRange: "10:20 - 12:10", room: "IB-302", instructor: "黃詠真", accent: .elective),
            ScheduleEntry(weekday: .friday, title: "體育：羽球", timeRange: "15:30 - 17:20", room: "體育館 B1", instructor: "張嘉宏", accent: .pe)
        ]
    }

    private static func demoPlannerSemesters() -> [PlannerSemester] {
        [
            PlannerSemester(name: "大一上", courses: [
                PlannerCourse(name: "微積分(一)", credits: 3, category: .compulsory, program: .home, instructor: "黃建豪", location: "MA-201", time: "一 1,2,3"),
                PlannerCourse(name: "程式設計", credits: 3, category: .compulsory, program: .home, instructor: "李宜庭", location: "IB-105", time: "二 2,3,4"),
                PlannerCourse(name: "大學國文", credits: 2, category: .chinese, program: .home, instructor: "林佳穎", location: "TR-301", time: "三 6,7")
            ]),
            PlannerSemester(name: "大一下", courses: [
                PlannerCourse(name: "微積分(二)", credits: 3, category: .compulsory, program: .home, instructor: "黃建豪", location: "MA-201", time: "一 1,2,3"),
                PlannerCourse(name: "資料結構", credits: 3, category: .compulsory, program: .home, instructor: "陳奕安", location: "IB-210", time: "四 2,3,4"),
                PlannerCourse(name: "英文聽講", credits: 2, category: .english, program: .home, instructor: "Amy Chen", location: "IB-406", time: "五 3,4")
            ]),
            PlannerSemester(name: "大二上", courses: [
                PlannerCourse(name: "機率", credits: 3, category: .compulsory, program: .home, instructor: "楊文祥", location: "MA-105", time: "二 1,2,3"),
                PlannerCourse(name: "資料庫系統", credits: 3, category: .compulsory, program: .home, instructor: "林大鈞", location: "RB-105", time: "二 6,7,8"),
                PlannerCourse(name: "通識：當代文明", credits: 2, category: .genEd, program: .home, dimension: .B, instructor: "王瑞華", location: "AU-205", time: "三 3,4")
            ]),
            PlannerSemester(name: "大二下", courses: [
                PlannerCourse(name: "作業系統", credits: 3, category: .compulsory, program: .home, instructor: "陳柏凱", location: "RB-202", time: "一 6,7,8"),
                PlannerCourse(name: "英文簡報與溝通", credits: 2, category: .english, program: .home, instructor: "Jessica Wu", location: "IB-201", time: "三 2,3"),
                PlannerCourse(name: "體育：游泳", credits: 0, category: .pe, program: .home, instructor: "張嘉宏", location: "游泳館", time: "五 7,8")
            ]),
            PlannerSemester(name: "大三上", courses: [
                PlannerCourse(name: "人機互動設計", credits: 3, category: .elective, program: .home, instructor: "王怡文", location: "TR-512", time: "一 2,3,4"),
                PlannerCourse(name: "通識：美感與人生", credits: 2, category: .genEd, program: .home, dimension: .C, instructor: "張若琳", location: "AU-110", time: "二 8,9"),
                PlannerCourse(name: "社會實踐", credits: 0, category: .social, program: .home, instructor: "服務學習中心", location: "校外服務", time: "彈性安排")
            ]),
            PlannerSemester(name: "大三下", courses: [
                PlannerCourse(name: "數位產品企劃", credits: 3, category: .elective, program: .home, instructor: "黃詠真", location: "IB-302", time: "四 3,4,5"),
                PlannerCourse(name: "通識：群己制度", credits: 2, category: .genEd, program: .home, dimension: .E, instructor: "宋哲民", location: "AU-220", time: "四 8,9")
            ]),
            PlannerSemester(name: "大四上", courses: [
                PlannerCourse(name: "畢業專題(一)", credits: 3, category: .compulsory, program: .home, instructor: "專題指導老師", location: "研究室", time: "另行約定"),
                PlannerCourse(name: "行動應用設計", credits: 3, category: .elective, program: .home, instructor: "邱正杰", location: "IB-506", time: "三 6,7,8")
            ]),
            PlannerSemester(name: "大四下", courses: [
                PlannerCourse(name: "畢業專題(二)", credits: 3, category: .compulsory, program: .home, instructor: "專題指導老師", location: "研究室", time: "另行約定"),
                PlannerCourse(name: "通識：自然生命", credits: 2, category: .genEd, program: .home, dimension: .F, instructor: "蘇品涵", location: "AU-115", time: "二 6,7")
            ])
        ]
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
