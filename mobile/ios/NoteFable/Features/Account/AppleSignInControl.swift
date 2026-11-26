import AuthenticationServices
import SwiftUI

/// 系统按钮保留 Apple 的文案及样式，nonce 到手后才打开授权窗口。
struct AppleSignInControl: UIViewRepresentable {
    typealias Request = @MainActor (String) async throws -> (code: String, name: String?)?
    let enabled: Bool
    let onPress: (@escaping Request) -> Void

    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(
            authorizationButtonType: .continue,
            authorizationButtonStyle: colorScheme == .dark ? .white : .black
        )
        button.cornerRadius = 8
        button.addTarget(context.coordinator, action: #selector(Coordinator.tap), for: .touchUpInside)
        context.coordinator.button = button
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        button.isEnabled = enabled
        button.isUserInteractionEnabled = enabled
        context.coordinator.onPress = onPress
    }

    static func dismantleUIView(_ uiView: ASAuthorizationAppleIDButton, coordinator: Coordinator) {
        coordinator.cancelPending()
    }

    @MainActor
    final class Coordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
        weak var button: ASAuthorizationAppleIDButton?
        var onPress: ((@escaping Request) -> Void)?
        private var controller: ASAuthorizationController?
        private var anchor: ASPresentationAnchor?
        private var pending: CheckedContinuation<(code: String, name: String?)?, Error>?

        @objc func tap() {
            guard pending == nil else { return }
            onPress? { nonce in try await self.request(nonce) }
        }

        private func request(_ nonce: String) async throws -> (code: String, name: String?)? {
            guard pending == nil, let window = button?.window else { throw URLError(.cannotLoadFromNetwork) }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.anchor = window
            self.controller = controller
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                controller.performRequests()
            }
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            anchor ?? ASPresentationAnchor()
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.authorizationCode, let code = String(data: data, encoding: .utf8) else {
                complete(.failure(URLError(.cannotDecodeContentData)))
                return
            }
            let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
            complete(.success((code, name)))
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            if (error as? ASAuthorizationError)?.code == .canceled {
                complete(.success(nil))
            } else {
                complete(.failure(error))
            }
        }

        func cancelPending() {
            guard pending != nil else { return }
            complete(.failure(CancellationError()))
        }

        private func complete(_ result: Result<(code: String, name: String?)?, Error>) {
            let continuation = pending
            pending = nil
            controller = nil
            anchor = nil
            continuation?.resume(with: result)
        }
    }
}
