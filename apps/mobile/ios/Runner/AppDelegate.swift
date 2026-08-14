import Flutter
import GoogleMaps
import UIKit
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate, UIDocumentPickerDelegate {
  private var pendingDocumentResult: FlutterResult?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    if let apiKey = Bundle.main.object(forInfoDictionaryKey: "GOOGLE_MAPS_IOS_API_KEY") as? String,
       !apiKey.isEmpty,
       !apiKey.hasPrefix("$(") {
      GMSServices.provideAPIKey(apiKey)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "CostaGoNativeActions") else {
      return
    }
    let channel = FlutterMethodChannel(
      name: "ec.atacames.mototaxi/native",
      binaryMessenger: registrar.messenger()
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "pickDocument" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.presentDocumentPicker(result: result)
    }
  }

  private func presentDocumentPicker(result: @escaping FlutterResult) {
    guard pendingDocumentResult == nil else {
      result(FlutterError(code: "DOCUMENT_PICKER_BUSY", message: "Ya hay un selector de documentos abierto.", details: nil))
      return
    }
    let types = [
      UTType.pdf,
      UTType(filenameExtension: "doc"),
      UTType(filenameExtension: "docx")
    ].compactMap { $0 }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
    picker.delegate = self
    pendingDocumentResult = result
    guard let presenter = activeViewController() else {
      pendingDocumentResult = nil
      result(FlutterError(code: "DOCUMENT_PICKER_UNAVAILABLE", message: "No se pudo abrir el selector de documentos.", details: nil))
      return
    }
    presenter.present(picker, animated: true)
  }

  private func activeViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?
      .rootViewController
    var current = root
    while let presented = current?.presentedViewController { current = presented }
    return current
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let result = pendingDocumentResult else { return }
    pendingDocumentResult = nil
    guard let url = urls.first else {
      result(nil)
      return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let data = try Data(contentsOf: url, options: .mappedIfSafe)
      let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
      result([
        "name": url.lastPathComponent,
        "mime": mime,
        "bytes": FlutterStandardTypedData(bytes: data)
      ])
    } catch {
      result(FlutterError(code: "DOCUMENT_READ_FAILED", message: "No se pudo leer el documento seleccionado.", details: nil))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingDocumentResult?(nil)
    pendingDocumentResult = nil
  }
}
