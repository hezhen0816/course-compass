import ActivityKit
import BackgroundTasks
import Foundation

/// Drives the "next class" Live Activity (Dynamic Island + lock screen).
///
/// Without a push server an activity can only be *started* while the app is in the
/// foreground, so the app starts it on launch / foreground / schedule sync and then keeps
/// the same activity up to date: at class start and class end a background refresh
/// (best effort, iOS decides when it runs) moves it on to the next class or ends it.
@MainActor
enum ClassLiveActivityController {
    static let refreshTaskIdentifier = "\(Bundle.main.bundleIdentifier ?? "org.example.coursecompass").class-activity-refresh"
    static let enabledStorageKey = "courseplanner.liveActivity.enabled"
    private static let planStorageKey = "courseplanner.liveActivity.todayPlan"

    /// One class meeting today, with concrete dates so the background refresh needs no schedule logic.
    struct PlannedClass: Codable, Equatable {
        let title: String
        let room: String
        let start: Date
        let end: Date
    }

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledStorageKey) as? Bool ?? true
    }

    private static var syncTask: Task<Void, Never>?

    /// Rebuilds today's plan from the schedule and starts / updates / ends the activity.
    /// Requests run one after another in call order, so the latest schedule always wins.
    static func requestSync(with courses: [UpcomingCourse]) {
        let previous = syncTask
        syncTask = Task {
            await previous?.value
            let now = Date()
            let plan = todayPlan(from: courses, now: now)
            savePlan(plan)
            await apply(plan: plan, now: now, canStart: true)
        }
    }

    /// Background refresh entry point: advances the running activity using the saved plan.
    static func refreshFromBackground() async {
        await apply(plan: loadPlan(), now: Date(), canStart: false)
    }

    private static func todayPlan(from courses: [UpcomingCourse], now: Date) -> [PlannedClass] {
        let today = Weekday.currentWeekday(from: now)
        return courses
            .filter { $0.weekday == today }
            .compactMap { course -> PlannedClass? in
                guard
                    let start = course.startDate(on: now),
                    let end = course.endDate(on: now),
                    end > start
                else {
                    return nil
                }
                let room = course.room.trimmingCharacters(in: .whitespacesAndNewlines)
                return PlannedClass(
                    title: course.title,
                    room: room,
                    start: start,
                    end: end
                )
            }
            .sorted { $0.start < $1.start }
    }

    private static func apply(plan: [PlannedClass], now: Date, canStart: Bool) async {
        let remaining = plan.filter { $0.end > now }
        let activities = Activity<ClassActivityAttributes>.activities

        guard isEnabled, let current = remaining.first else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshTaskIdentifier)
            for activity in activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            return
        }

        let following = remaining.dropFirst().first
        let state = ClassActivityAttributes.ContentState(
            title: current.title,
            room: current.room,
            startDate: current.start,
            endDate: current.end,
            nextTitle: following?.title,
            nextRoom: following?.room,
            nextStartDate: following?.start
        )
        let content = ActivityContent(state: state, staleDate: current.end)

        if let existing = activities.first {
            // Always update, even with the same state: the views decide "before / in class"
            // when they are rendered, so a re-render at class start flips the phase.
            await existing.update(content)
            for extra in activities.dropFirst() {
                await extra.end(nil, dismissalPolicy: .immediate)
            }
        } else if canStart, ActivityAuthorizationInfo().areActivitiesEnabled {
            do {
                _ = try Activity.request(attributes: ClassActivityAttributes(), content: content, pushType: nil)
            } catch {
                print("Live Activity request failed: \(error)")
            }
        }

        scheduleRefresh(at: now < current.start ? current.start : current.end)
    }

    private static func scheduleRefresh(at date: Date) {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
        request.earliestBeginDate = date
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Simulator and some states refuse background tasks; the next foreground sync covers it.
            print("Live Activity refresh scheduling failed: \(error)")
        }
    }

    private static func savePlan(_ plan: [PlannedClass]) {
        if let data = try? JSONEncoder().encode(plan) {
            UserDefaults.standard.set(data, forKey: planStorageKey)
        }
    }

    private static func loadPlan() -> [PlannedClass] {
        guard
            let data = UserDefaults.standard.data(forKey: planStorageKey),
            let plan = try? JSONDecoder().decode([PlannedClass].self, from: data)
        else {
            return []
        }
        return plan
    }
}
