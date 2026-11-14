# StudyMate iOS

原生 iOS 客户端的位置，尚未开始开发。

- 用 Swift / SwiftUI 写原生 App，不用 Capacitor、Flutter、React Native 等跨平台方案。
- 和 Android 客户端（`mobile/android/`）一样，只通过服务器 API 工作：模型列表来自 `GET /api/models`，不在客户端写死。
- 界面照搬网页端：先测量网页（CSS、计算样式、i18n 词典），不自创样式、深色模式或文案。

Android 客户端的做法见 [docs/architecture/android-native.md](../../docs/architecture/android-native.md)。
