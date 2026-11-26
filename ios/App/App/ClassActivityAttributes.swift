import ActivityKit
import Foundation

/// Live Activity payload for "the next class today", shared by the app and the widget extension.
/// The app starts one activity per day and keeps updating it as classes pass.
struct ClassActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var room: String
        var startDate: Date
        var endDate: Date
        /// The class after this one today, if any.
        var nextTitle: String?
        var nextRoom: String?
        var nextStartDate: Date?
    }
}
