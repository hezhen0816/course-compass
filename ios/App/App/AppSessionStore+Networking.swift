import Foundation

extension AppSessionStore {
    func makeURL(path: String) throws -> URL {
        guard
            let supabaseURL,
            let url = URL(string: path, relativeTo: supabaseURL)
        else {
            throw NSError(domain: "CoursePlannerAuth", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "雲端服務網址設定錯誤"
            ])
        }
        return url.absoluteURL
    }

    func applyAPIHeaders(to request: inout URLRequest) {
        guard let supabaseAnonKey else {
            return
        }

        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    func applyBackendAuthorization(to request: inout URLRequest) async throws {
        let session = try await validSession()
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
    }

    func saveSchoolCredentialsIfNeeded(username: String, password: String) async throws {
        let trimmedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPassword.isEmpty else {
            return
        }

        let endpoint = try Self.backendURL(path: "/api/school-credentials")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyBackendAuthorization(to: &request)
        request.httpBody = try JSONEncoder().encode(
            SchoolCredentialsSaveRequest(
                username: username,
                password: trimmedPassword
            )
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response, data: data)
        _ = try? JSONDecoder().decode(SchoolCredentialsStatusResponse.self, from: data)
    }

    func performJSONRequest<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response, data: data)

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    func validateHTTPResponse(_ response: URLResponse, data: Data) throws {
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

    var supabaseURL: URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String else {
            return nil
        }
        return URL(string: rawValue)
    }

    var supabaseAnonKey: String? {
        Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String
    }

    // No fallback host: a missing BackendServiceBaseURL must fail loudly rather
    // than send school credentials to a domain this project no longer controls.
    static var backendServiceBaseURL: String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: "BackendServiceBaseURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    static func backendURL(path: String) throws -> URL {
        guard
            let rawBaseURL = backendServiceBaseURL,
            let baseURL = URL(string: rawBaseURL),
            let url = URL(string: path, relativeTo: baseURL)
        else {
            throw URLError(.badURL, userInfo: [NSLocalizedDescriptionKey: "App 未設定同步服務網址（BackendServiceBaseURL）。"])
        }
        return url.absoluteURL
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }
}
