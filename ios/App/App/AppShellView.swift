import SwiftUI

struct AppShellView: View {
    @StateObject private var store = AppSessionStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if !store.isAuthenticated {
                AuthGateView()
            } else if store.requiresBiometricUnlock {
                BiometricLockView()
            } else {
                authenticatedShell
            }
        }
        .environmentObject(store)
        .tint(Theme.signal)
        // 多工切換畫面的縮圖是在 .inactive 時拍的，這層遮罩就是原本「一離開前景就鎖」
        // 買到的隱私效果，但不必逼使用者再掃一次臉。
        .overlay {
            if scenePhase != .active, store.shouldUseBiometricUnlock, !store.isBiometricAuthenticating {
                PrivacyCoverView()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard store.isAuthenticated else {
                return
            }

            switch newPhase {
            case .active:
                store.lockIfBiometricGracePeriodExpired()
                guard !store.requiresBiometricUnlock else {
                    return
                }

                store.syncClassLiveActivity()
                Task {
                    await store.refreshAppContent(suppressErrors: true)
                }
            case .background:
                guard !store.isBiometricAuthenticating else {
                    return
                }

                store.markEnteredBackground()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
    }

    private var authenticatedShell: some View {
        TabView(selection: $store.selectedTab) {
            NavigationStack {
                HomeView()
            }
            .tabItem {
                Label("今天", systemImage: "sun.horizon")
            }
            .tag(AppTab.home)

            NavigationStack {
                ScheduleView()
            }
            .tabItem {
                Label(AppTab.schedule.title, systemImage: "tablecells")
            }
            .tag(AppTab.schedule)

            NavigationStack {
                FreeRoomsView()
            }
            .tabItem {
                Label(AppTab.rooms.title, systemImage: "door.left.hand.open")
            }
            .tag(AppTab.rooms)

            NavigationStack {
                PlannerView()
            }
            .tabItem {
                Label(AppTab.planner.title, systemImage: "graduationcap")
            }
            .tag(AppTab.planner)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label(AppTab.settings.title, systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
        .tint(Theme.signal)
    }
}

/// App wordmark: heavy title over a 2-pt ink rule, shared by the auth, lock and privacy screens.
private struct Wordmark: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Image(systemName: "location.north.line.fill")
                    .font(.title2.weight(.heavy))
                    .foregroundStyle(Theme.signal)
                    .accessibilityHidden(true)
                Text("修課羅盤")
                    .font(.largeTitle.weight(.heavy))
                    .foregroundStyle(Theme.ink)
            }
            Rectangle()
                .fill(Theme.ink)
                .frame(height: 2)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// 切到多工畫面／控制中心時蓋住內容，只擋畫面不要求解鎖。
private struct PrivacyCoverView: View {
    var body: some View {
        ZStack {
            Theme.canvas
            VStack(spacing: Theme.Space.m) {
                Image(systemName: "lock.fill")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Text("修課羅盤")
                    .font(Theme.Typeface.eyebrow)
                    .foregroundStyle(Theme.inkSecondary)
            }
        }
        .ignoresSafeArea()
        .transition(.opacity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("修課羅盤已遮蔽")
    }
}

private struct BiometricLockView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var didAttemptAutomaticUnlock = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                Wordmark()
                    .padding(.top, Theme.Space.xxl)

                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Image(systemName: "faceid")
                        .font(.system(size: 44, weight: .regular))
                        .foregroundStyle(Theme.ink)
                        .accessibilityHidden(true)
                    Text("使用 \(store.localizedBiometricName) 解鎖")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.ink)
                    Text(store.currentUserEmail ?? "修課羅盤")
                        .font(Theme.Typeface.codeSmall)
                        .foregroundStyle(Theme.inkSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.top, Theme.Space.l)

                if let biometricAuthErrorMessage = store.biometricAuthErrorMessage {
                    Callout(text: biometricAuthErrorMessage, tone: .danger, systemImage: "exclamationmark.triangle.fill")
                }

                VStack(spacing: Theme.Space.m) {
                    Button {
                        Task {
                            await store.unlockWithBiometrics()
                        }
                    } label: {
                        HStack(spacing: Theme.Space.s) {
                            if store.isBiometricAuthenticating {
                                ProgressView()
                                    .tint(Theme.onFill)
                            } else {
                                Image(systemName: "faceid")
                            }
                            Text(store.isBiometricAuthenticating ? "驗證中..." : "解鎖")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(store.isBiometricAuthenticating)

                    Button(role: .destructive) {
                        Task {
                            await store.signOut()
                        }
                    } label: {
                        Label("改用 Email 登入", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(OutlineButtonStyle(tone: .danger))
                }
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 440, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.canvas.ignoresSafeArea())
        .task {
            guard !didAttemptAutomaticUnlock else {
                return
            }

            didAttemptAutomaticUnlock = true
            await store.unlockWithBiometrics()
        }
    }
}

private struct AuthGateView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var email = ""
    @State private var password = ""
    @State private var authMode: AuthFormMode = .login
    @FocusState private var focusedField: AuthField?
    @Namespace private var modeIndicator

    var body: some View {
        // ScrollView (not a fixed VStack) so the keyboard's safe-area inset
        // pushes the form up instead of covering the password field.
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    Wordmark()
                    Text("登入後即可同步課表、匯入修課紀錄，並延續你的學分規劃。")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, Theme.Space.xxl)

                modeSwitcher

                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    field(label: "Email") {
                        TextField("name@example.com", text: $email)
                            .textInputAutocapitalization(.never)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled(true)
                            .focused($focusedField, equals: .email)
                            .submitLabel(.next)
                            .onSubmit {
                                focusedField = .password
                            }
                    }

                    field(label: "密碼") {
                        SecureField("輸入密碼", text: $password)
                            .textContentType(.password)
                            .focused($focusedField, equals: .password)
                            .submitLabel(.go)
                            .onSubmit {
                                submitAuth()
                            }
                    }
                }

                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    Button {
                        submitAuth()
                    } label: {
                        HStack(spacing: Theme.Space.s) {
                            if store.isAuthenticating {
                                ProgressView()
                                    .tint(Theme.onFill)
                            }
                            Text(store.isAuthenticating ? "處理中..." : authMode.title)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(store.isAuthenticating || !store.isAuthConfigured)

                    if let authErrorMessage = store.authErrorMessage {
                        Callout(text: authErrorMessage, tone: .danger, systemImage: "exclamationmark.triangle.fill")
                    }

                    if let authNoticeMessage = store.authNoticeMessage {
                        Callout(text: authNoticeMessage, tone: .go, systemImage: "checkmark.circle.fill")
                    }

                    if !store.isAuthConfigured {
                        Callout(text: "iOS 尚未完成雲端登入設定", tone: .busy, systemImage: "gearshape.2.fill")
                    }

                    Button {
                        switchMode(to: authMode == .login ? .signup : .login)
                    } label: {
                        Text(authMode.toggleTitle)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.inkSecondary)
                            .underline()
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 440, alignment: .leading)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture {
                focusedField = nil
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.canvas.ignoresSafeArea())
    }

    /// Two text tabs with a sliding underline (login / sign-up).
    private var modeSwitcher: some View {
        HStack(spacing: Theme.Space.xl) {
            ForEach([AuthFormMode.login, .signup], id: \.title) { mode in
                let isSelected = authMode == mode
                Button {
                    switchMode(to: mode)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(mode.title)
                            .font(.headline.weight(isSelected ? .heavy : .semibold))
                            .foregroundStyle(isSelected ? Theme.ink : Theme.inkSecondary)
                        ZStack {
                            Rectangle().fill(Color.clear).frame(height: 3)
                            if isSelected {
                                Rectangle()
                                    .fill(Theme.signal)
                                    .frame(height: 3)
                                    .matchedGeometryEffect(id: "indicator", in: modeIndicator)
                            }
                        }
                    }
                    .fixedSize(horizontal: true, vertical: false)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
            Spacer(minLength: 0)
        }
    }

    private func field<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.inkSecondary)
                .accessibilityHidden(true)
            content()
                .font(.body)
                .foregroundStyle(Theme.ink)
                .fieldChrome()
                .accessibilityLabel(label)
        }
    }

    private func switchMode(to mode: AuthFormMode) {
        withAnimation(.snappy(duration: 0.25)) {
            authMode = mode
        }
    }

    private func submitAuth() {
        focusedField = nil
        Task {
            if authMode == .login {
                await store.signIn(email: email, password: password)
            } else {
                await store.signUp(email: email, password: password)
            }
        }
    }
}

private enum AuthField: Hashable {
    case email
    case password
}
