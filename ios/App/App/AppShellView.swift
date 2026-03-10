import SwiftUI

struct AppShellView: View {
    @StateObject private var store = AppSessionStore()

    var body: some View {
        Group {
            if store.isRestoringSession {
                ZStack {
                    authBackground
                    VStack(spacing: 18) {
                        ProgressView()
                            .controlSize(.large)
                            .tint(.indigo)
                        Text("正在恢復登入狀態...")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.primary)
                    }
                    .padding(28)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .padding(24)
                }
            } else if !store.isAuthenticated {
                AuthGateView()
            } else {
                authenticatedShell
            }
        }
        .environmentObject(store)
    }

    private var authBackground: some View {
        ZStack {
            Color(.systemGroupedBackground)
            LinearGradient(
                colors: [Color.indigo.opacity(0.12), Color.cyan.opacity(0.08), Color.white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(Color.indigo.opacity(0.12))
                .frame(width: 220, height: 220)
                .blur(radius: 8)
                .offset(x: 120, y: -250)
            Circle()
                .fill(Color.cyan.opacity(0.12))
                .frame(width: 180, height: 180)
                .blur(radius: 10)
                .offset(x: -140, y: 280)
        }
        .ignoresSafeArea()
    }

    private var authenticatedShell: some View {
        TabView(selection: $store.selectedTab) {
            NavigationStack {
                HomeView()
            }
            .tabItem {
                Label(AppTab.home.title, systemImage: AppTab.home.systemImage)
            }
            .tag(AppTab.home)

            NavigationStack {
                ScheduleView()
            }
            .tabItem {
                Label(AppTab.schedule.title, systemImage: AppTab.schedule.systemImage)
            }
            .tag(AppTab.schedule)

            NavigationStack {
                PlannerView()
            }
            .tabItem {
                Label(AppTab.planner.title, systemImage: AppTab.planner.systemImage)
            }
            .tag(AppTab.planner)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label(AppTab.settings.title, systemImage: AppTab.settings.systemImage)
            }
            .tag(AppTab.settings)
        }
        .tint(.indigo)
    }
}

private struct AuthGateView: View {
    @EnvironmentObject private var store: AppSessionStore
    @State private var email = ""
    @State private var password = ""
    @State private var authMode: AuthFormMode = .login

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground)
                LinearGradient(
                    colors: [Color.indigo.opacity(0.12), Color.cyan.opacity(0.08), Color.white],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Circle()
                    .fill(Color.indigo.opacity(0.12))
                    .frame(width: 220, height: 220)
                    .blur(radius: 8)
                    .offset(x: 120, y: -250)
                Circle()
                    .fill(Color.cyan.opacity(0.12))
                    .frame(width: 180, height: 180)
                    .blur(radius: 10)
                    .offset(x: -140, y: 280)

                VStack(spacing: 0) {
                    Spacer(minLength: 40)

                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 12) {
                                Image(systemName: "graduationcap.fill")
                                    .font(.title3.weight(.bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 46, height: 46)
                                    .background(
                                        LinearGradient(
                                            colors: [Color.indigo, Color.blue],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    )
                                Text("修課規劃助手")
                                    .font(.system(size: 34, weight: .bold, design: .rounded))
                            }

                            Text("登入帳號後，學分規劃會跟著帳號保存，並在不同裝置間保持同步。")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        HStack(spacing: 10) {
                            authModeChip(.login)
                            authModeChip(.signup)
                        }

                        VStack(alignment: .leading, spacing: 14) {
                            authFieldLabel("Email")
                            TextField("name@example.com", text: $email)
                                .textInputAutocapitalization(.never)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .autocorrectionDisabled(true)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                            authFieldLabel("密碼")
                            SecureField("輸入密碼", text: $password)
                                .textContentType(.password)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }

                        Button {
                            Task {
                                if authMode == .login {
                                    await store.signIn(email: email, password: password)
                                } else {
                                    await store.signUp(email: email, password: password)
                                }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Spacer()
                                if store.isAuthenticating {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text(store.isAuthenticating ? "處理中..." : authMode.title)
                                    .font(.headline.weight(.semibold))
                                Spacer()
                            }
                            .foregroundStyle(.white)
                            .padding(.vertical, 16)
                            .background(
                                LinearGradient(
                                    colors: [Color.indigo, Color.blue],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                ),
                                in: Capsule()
                            )
                        }
                        .disabled(store.isAuthenticating || !store.isAuthConfigured)
                        .opacity(store.isAuthenticating || !store.isAuthConfigured ? 0.65 : 1)

                        if let authErrorMessage = store.authErrorMessage {
                            statusBanner(text: authErrorMessage, color: .red, systemImage: "exclamationmark.triangle.fill")
                        }

                        if let authNoticeMessage = store.authNoticeMessage {
                            statusBanner(text: authNoticeMessage, color: .green, systemImage: "checkmark.circle.fill")
                        }

                        if !store.isAuthConfigured {
                            statusBanner(text: "iOS 尚未完成雲端登入設定", color: .orange, systemImage: "gearshape.2.fill")
                        }

                        Text(authMode == .login ? "沒有帳號？切換到註冊建立新帳號" : "已經有帳號？切換回登入")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 30, style: .continuous)
                            .stroke(Color.white.opacity(0.45), lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.06), radius: 18, y: 10)
                    .padding(.horizontal, 22)

                    Spacer(minLength: 40)
                }
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)
        }
    }

    private func authModeChip(_ mode: AuthFormMode) -> some View {
        Button {
            authMode = mode
        } label: {
            Text(mode.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(authMode == mode ? .white : .primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background {
                    Capsule()
                        .fill(
                            authMode == mode
                            ? AnyShapeStyle(LinearGradient(colors: [Color.indigo, Color.blue], startPoint: .leading, endPoint: .trailing))
                            : AnyShapeStyle(Color(.secondarySystemBackground))
                        )
                }
        }
        .buttonStyle(.plain)
    }

    private func authFieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
    }

    private func statusBanner(text: String, color: Color, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .foregroundStyle(color)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
