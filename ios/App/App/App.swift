import SwiftUI
import UIKit

@main
struct CoursePlannerApp: App {
    init() {
        UINavigationBar.appearance().tintColor = .systemIndigo
        UITabBar.appearance().tintColor = .systemIndigo
    }

    var body: some Scene {
        WindowGroup {
            AppShellView()
        }
    }
}
