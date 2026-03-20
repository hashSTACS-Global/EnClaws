import AppKit
import Observation
import SwiftUI
import UniformTypeIdentifiers

struct DebugSettings: View {
    @Bindable var state: AppState
    private let isPreview = ProcessInfo.processInfo.isPreview
    private let labelColumnWidth: CGFloat = 140
    @AppStorage(modelCatalogPathKey) private var modelCatalogPath: String = ModelCatalogLoader.defaultPath
    @AppStorage(modelCatalogReloadKey) private var modelCatalogReloadBump: Int = 0
    @AppStorage(iconOverrideKey) private var iconOverrideRaw: String = IconOverrideSelection.system.rawValue
    @AppStorage(canvasEnabledKey) private var canvasEnabled: Bool = true
    @State private var modelsCount: Int?
    @State private var modelsLoading = false
    @State private var modelsError: String?
    private let gatewayManager = GatewayProcessManager.shared
    private let healthStore = HealthStore.shared
    @State private var launchAgentWriteDisabled = GatewayLaunchAgentManager.isLaunchAgentWriteDisabled()
    @State private var launchAgentWriteError: String?
    @State private var gatewayRootInput: String = GatewayProcessManager.shared.projectRootPath()
    @State private var sessionStorePath: String = SessionLoader.defaultStorePath
    @State private var sessionStoreSaveError: String?
    @State private var debugSendInFlight = false
    @State private var debugSendStatus: String?
    @State private var debugSendError: String?
    @State private var portCheckInFlight = false
    @State private var portReports: [DebugActions.PortReport] = []
    @State private var portKillStatus: String?
    @State private var tunnelResetInFlight = false
    @State private var tunnelResetStatus: String?
    @State private var pendingKill: DebugActions.PortListener?
    @AppStorage(debugFileLogEnabledKey) private var diagnosticsFileLogEnabled: Bool = false
    @AppStorage(appLogLevelKey) private var appLogLevelRaw: String = AppLogLevel.default.rawValue

    @State private var canvasSessionKey: String = "main"
    @State private var canvasStatus: String?
    @State private var canvasError: String?
    @State private var canvasEvalJS: String = "document.title"
    @State private var canvasEvalResult: String?
    @State private var canvasSnapshotPath: String?

    init(state: AppState = AppStateStore.shared) {
        self.state = state
    }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 14) {
                self.header

                self.launchdSection
                self.appInfoSection
                self.gatewaySection
                self.logsSection
                self.portsSection
                self.pathsSection
                self.quickActionsSection
                self.canvasSection
                self.experimentsSection

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
            .groupBoxStyle(PlainSettingsGroupBoxStyle())
        }
        .task {
            guard !self.isPreview else { return }
            await self.reloadModels()
            self.loadSessionStorePath()
        }
        .alert(item: self.$pendingKill) { listener in
            Alert(
                title: Text("终止进程 \(listener.command)？"),
                message: Text("此进程看起来符合当前模式。仍要尝试终止吗？"),
                primaryButton: .destructive(Text("终止")) {
                    Task { await self.killConfirmed(listener.pid) }
                },
                secondaryButton: .cancel(Text("取消")))
        }
    }

    private var launchdSection: some View {
        GroupBox("Gateway startup") {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("仅附加 (跳过 launchd 安装)", isOn: self.$launchAgentWriteDisabled)
                    .onChange(of: self.launchAgentWriteDisabled) { _, newValue in
                        self.launchAgentWriteError = GatewayLaunchAgentManager.setLaunchAgentWriteDisabled(newValue)
                        if self.launchAgentWriteError != nil {
                            self.launchAgentWriteDisabled = GatewayLaunchAgentManager.isLaunchAgentWriteDisabled()
                            return
                        }
                        if newValue {
                            Task {
                                _ = await GatewayLaunchAgentManager.set(
                                    enabled: false,
                                    bundlePath: Bundle.main.bundlePath,
                                    port: GatewayEnvironment.gatewayPort())
                            }
                        }
                    }

                Text(
                    "开启时，OpenClaw 不会安装或管理 \(gatewayLaunchdLabel)。" +
                        "它将仅附加到现有独立运行的网关进程。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let launchAgentWriteError {
                    Text(launchAgentWriteError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("调试")
                .font(.title3.weight(.semibold))
            Text("用于诊断本地问题的工具（网关、端口、日志、画板）。")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private func gridLabel(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(width: self.labelColumnWidth, alignment: .leading)
    }

    private var appInfoSection: some View {
        GroupBox("App") {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    self.gridLabel("运行健康")
                    HStack(spacing: 8) {
                        Circle().fill(self.healthStore.state.tint).frame(width: 10, height: 10)
                        Text(self.healthStore.summaryLine)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                GridRow {
                    self.gridLabel("命令行")
                    let loc = CLIInstaller.installedLocation()
                    Text(loc ?? "missing")
                        .font(.caption.monospaced())
                        .foregroundStyle(loc == nil ? Color.red : Color.secondary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                GridRow {
                    self.gridLabel("进程 PID")
                    Text("\(ProcessInfo.processInfo.processIdentifier)")
                }
                GridRow {
                    self.gridLabel("可执行文件路径")
                    Text(Bundle.main.bundlePath)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }

    private var gatewaySection: some View {
        GroupBox("Gateway") {
            VStack(alignment: .leading, spacing: 10) {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    GridRow {
                        self.gridLabel("Status")
                        HStack(spacing: 8) {
                            Text(self.gatewayManager.status.label)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                let key = DeepLinkHandler.currentKey()
                HStack(spacing: 8) {
                    Text("键")
                        .foregroundStyle(.secondary)
                        .frame(width: self.labelColumnWidth, alignment: .leading)
                    Text(key)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button("复制") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(key, forType: .string)
                    }
                    .buttonStyle(.bordered)
                    Button("复制示例链接") {
                        let msg = "Hello from deep link"
                        let encoded = msg.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? msg
                        let url = "openclaw://agent?message=\(encoded)&key=\(key)"
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(url, forType: .string)
                    }
                    .buttonStyle(.bordered)
                    Spacer(minLength: 0)
                }

                Text("深度链接始终启用；此开关控制无人值守的调用。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Stdout / stderr")
                        .font(.caption.weight(.semibold))
                    ScrollView {
                        Text(self.gatewayManager.log.isEmpty ? "—" : self.gatewayManager.log)
                            .font(.caption.monospaced())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(height: 180)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.2)))

                    HStack(spacing: 8) {
                        if self.canRestartGateway {
                            Button("重启网关") { DebugActions.restartGateway() }
                        }
                        Button("清除日志") { GatewayProcessManager.shared.clearLog() }
                        Spacer(minLength: 0)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var logsSection: some View {
        GroupBox("Logs") {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    self.gridLabel("查看 Pino 原始执行日志")
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Button("打开") { DebugActions.openLog() }
                                .buttonStyle(.bordered)
                            Text(DebugActions.pinoLogPath())
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }

                GridRow {
                    self.gridLabel("应用日志")
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("Verbosity", selection: self.$appLogLevelRaw) {
                            ForEach(AppLogLevel.allCases) { level in
                                Text(level.title).tag(level.rawValue)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .help("Controls the macOS app log verbosity.")

                        Toggle("写入轮转诊断日志 (JSONL)", isOn: self.$diagnosticsFileLogEnabled)
                            .toggleStyle(.checkbox)
                            .help(
                                "在 ~/Library/Logs/OpenClaw/ 下写入本地轮转日志。" +
                                    "仅在主动调试排错时启用。")

                        HStack(spacing: 8) {
                            Button("打开目录") {
                                NSWorkspace.shared.open(DiagnosticsFileLog.logDirectoryURL())
                            }
                            .buttonStyle(.bordered)
                            Button("清除") {
                                Task { try? await DiagnosticsFileLog.shared.clear() }
                            }
                            .buttonStyle(.bordered)
                        }
                        Text(DiagnosticsFileLog.logFileURL().path)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    private var portsSection: some View {
        GroupBox("Ports") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text("执行接口占用诊断")
                        .font(.caption.weight(.semibold))
                    if self.portCheckInFlight { ProgressView().controlSize(.small) }
                    Spacer()
                    Button("检查网关端口") {
                        Task { await self.runPortCheck() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.portCheckInFlight)
                    Button("断开清退 SSH 隧道连接重新映射") {
                        Task { await self.resetGatewayTunnel() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.tunnelResetInFlight || !self.isRemoteMode)
                }

                if let portKillStatus {
                    Text(portKillStatus)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let tunnelResetStatus {
                    Text(tunnelResetStatus)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if self.portReports.isEmpty, !self.portCheckInFlight {
                    Text("诊断占用 \(GatewayEnvironment.gatewayPort()) 端口的进程。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(self.portReports) { report in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("端口占用: \(report.port)")
                                .font(.footnote.weight(.semibold))
                            Text(report.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            ForEach(report.listeners) { listener in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text("\(listener.command) (\(listener.pid))")
                                            .font(.caption.monospaced())
                                            .foregroundStyle(listener.expected ? .secondary : Color.red)
                                            .lineLimit(1)
                                        Spacer()
                                        Button("终止") {
                                            self.requestKill(listener)
                                        }
                                        .buttonStyle(.bordered)
                                    }
                                    Text(listener.fullCommand)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                        .truncationMode(.middle)
                                }
                                .padding(6)
                                .background(Color.secondary.opacity(0.05))
                                .cornerRadius(4)
                            }
                        }
                        .padding(8)
                        .background(Color.secondary.opacity(0.08))
                        .cornerRadius(6)
                    }
                }
            }
        }
    }

    private var pathsSection: some View {
        GroupBox("Paths") {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("工程配置仓库根目录")
                        .font(.caption.weight(.semibold))
                    HStack(spacing: 8) {
                        TextField("OpenClaw 项目路径", text: self.$gatewayRootInput)
                            .textFieldStyle(.roundedBorder)
                            .font(.caption.monospaced())
                            .onSubmit { self.saveRelayRoot() }
                        Button("保存") { self.saveRelayRoot() }
                            .buttonStyle(.borderedProminent)
                        Button("恢复初始") {
                            let def = FileManager().homeDirectoryForCurrentUser
                                .appendingPathComponent("Projects/openclaw").path
                            self.gatewayRootInput = def
                            self.saveRelayRoot()
                        }
                        .buttonStyle(.bordered)
                    }
                    Text("启动网关时用于备选探测 pnpm/node 以及填充执行 PATH 环境。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    GridRow {
                        self.gridLabel("会话存储路径")
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                TextField("Path", text: self.$sessionStorePath)
                                    .textFieldStyle(.roundedBorder)
                                    .font(.caption.monospaced())
                                    .frame(width: 360)
                                Button("保存") { self.saveSessionStorePath() }
                                    .buttonStyle(.borderedProminent)
                            }
                            if let sessionStoreSaveError {
                                Text(sessionStoreSaveError)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("CLI 会话加载器使用的路径；存储于 ~/.openclaw/openclaw.json 中。")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    GridRow {
                        self.gridLabel("可用大模型目录")
                        VStack(alignment: .leading, spacing: 6) {
                            Text(self.modelCatalogPath)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            HStack(spacing: 8) {
                                Button {
                                    self.chooseCatalogFile()
                                } label: {
                                    Label("选择 models.generated.ts…", systemImage: "folder")
                                }
                                .buttonStyle(.bordered)

                                Button {
                                    Task { await self.reloadModels() }
                                } label: {
                                    Label(
                                        self.modelsLoading ? "努力加载中…" : "重新加载模型",
                                        systemImage: "arrow.clockwise")
                                }
                                .buttonStyle(.bordered)
                                .disabled(self.modelsLoading)
                            }
                            if let modelsError {
                                Text(modelsError)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            } else if let modelsCount {
                                Text("已加载 \(modelsCount) 模型")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Text("网关模型不可用时的本地降级组件。")
                                .font(.footnote)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
    }

    private var quickActionsSection: some View {
        GroupBox("快速调试选项") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Button("发送测试系统通知") {
                        Task { await DebugActions.sendTestNotification() }
                    }
                    .buttonStyle(.bordered)

                    Button("监听代理事件") {
                        DebugActions.openAgentEventsWindow()
                    }
                    .buttonStyle(.borderedProminent)

                    Spacer(minLength: 0)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Button {
                        Task { await self.sendVoiceDebug() }
                    } label: {
                        Label(
                            self.debugSendInFlight ? "正在发送测试语音音频…" : "发送模拟语音输入",
                            systemImage: self.debugSendInFlight ? "bolt.horizontal.circle" : "waveform")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.debugSendInFlight)

                    if !self.debugSendInFlight {
                        if let debugSendStatus {
                            Text(debugSendStatus)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let debugSendError {
                            Text(debugSendError)
                                .font(.caption)
                                .foregroundStyle(.red)
                        } else {
                            Text(
                                """
                                使用语音唤醒通道：配置为远程时通过 SSH 转发处理，否则本地触发 RPC 接口响应。
                                """)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("注意：为使隐私许可彻底生效，您可能需要重启 OpenClaw。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Button {
                        LaunchdManager.startOpenClaw()
                    } label: {
                        Label("彻底重启 OpenClaw", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                HStack(spacing: 8) {
                    Button("重启应用进程") { DebugActions.restartApp() }
                    Button("重新启动向导配置") { DebugActions.restartOnboarding() }
                    Button("在访达中显示应用包") { self.revealApp() }
                    Spacer(minLength: 0)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var canvasSection: some View {
        GroupBox("Canvas") {
            VStack(alignment: .leading, spacing: 10) {
                Text("在通用设置中开关 Canvas。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    TextField("会话ID", text: self.$canvasSessionKey)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption.monospaced())
                        .frame(width: 160)
                    Button("显示悬浮画板") {
                        Task { await self.canvasPresent() }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("隐藏面板") {
                        CanvasManager.shared.hideAll()
                        self.canvasStatus = "hidden"
                        self.canvasError = nil
                    }
                    .buttonStyle(.bordered)
                    Button("写入样例渲染内容") {
                        Task { await self.canvasWriteSamplePage() }
                    }
                    .buttonStyle(.bordered)
                    Spacer(minLength: 0)
                }

                HStack(spacing: 8) {
                    TextField("Eval JS", text: self.$canvasEvalJS)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption.monospaced())
                        .frame(maxWidth: 520)
                    Button("评估执行") {
                        Task { await self.canvasEval() }
                    }
                    .buttonStyle(.bordered)
                    Button("捕获画板快照") {
                        Task { await self.canvasSnapshot() }
                    }
                    .buttonStyle(.bordered)
                    Spacer(minLength: 0)
                }

                if let canvasStatus {
                    Text(canvasStatus)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                if let canvasEvalResult {
                    Text("eval → \(canvasEvalResult)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                if let canvasSnapshotPath {
                    HStack(spacing: 8) {
                        Text("snapshot → \(canvasSnapshotPath)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                        Button("在文件浏览器中查看") {
                            NSWorkspace.shared
                                .activateFileViewerSelecting([URL(fileURLWithPath: canvasSnapshotPath)])
                        }
                        .buttonStyle(.bordered)
                        Spacer(minLength: 0)
                    }
                }
                if let canvasError {
                    Text(canvasError)
                        .font(.caption2)
                        .foregroundStyle(.red)
                } else {
                    Text("提示: 画板所依赖的会话目录可通过调出“显示悬浮画板”生成。")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    private var experimentsSection: some View {
        GroupBox("实验室实验特性") {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    self.gridLabel("自定义图标")
                    Picker("", selection: self.bindingOverride) {
                        ForEach(IconOverrideSelection.allCases) { option in
                            Text(option.label).tag(option.rawValue)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 280, alignment: .leading)
                }
                GridRow {
                    self.gridLabel("聊天")
                    Text("原生 SwiftUI")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @MainActor
    private func runPortCheck() async {
        self.portCheckInFlight = true
        self.portKillStatus = nil
        let reports = await DebugActions.checkGatewayPorts()
        self.portReports = reports
        self.portCheckInFlight = false
    }

    @MainActor
    private func resetGatewayTunnel() async {
        self.tunnelResetInFlight = true
        self.tunnelResetStatus = nil
        let result = await DebugActions.resetGatewayTunnel()
        switch result {
        case let .success(message):
            self.tunnelResetStatus = message
        case let .failure(err):
            self.tunnelResetStatus = err.localizedDescription
        }
        await self.runPortCheck()
        self.tunnelResetInFlight = false
    }

    @MainActor
    private func requestKill(_ listener: DebugActions.PortListener) {
        if listener.expected {
            self.pendingKill = listener
        } else {
            Task { await self.killConfirmed(listener.pid) }
        }
    }

    @MainActor
    private func killConfirmed(_ pid: Int32) async {
        let result = await DebugActions.killProcess(Int(pid))
        switch result {
        case .success:
            self.portKillStatus = "Sent kill to \(pid)."
            await self.runPortCheck()
        case let .failure(err):
            self.portKillStatus = "Kill \(pid) failed: \(err.localizedDescription)"
        }
    }

    private func chooseCatalogFile() {
        let panel = NSOpenPanel()
        panel.title = "Select models.generated.ts"
        let tsType = UTType(filenameExtension: "ts")
            ?? UTType(tag: "ts", tagClass: .filenameExtension, conformingTo: .sourceCode)
            ?? .item
        panel.allowedContentTypes = [tsType]
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: self.modelCatalogPath).deletingLastPathComponent()
        if panel.runModal() == .OK, let url = panel.url {
            self.modelCatalogPath = url.path
            self.modelCatalogReloadBump += 1
            Task { await self.reloadModels() }
        }
    }

    private func reloadModels() async {
        guard !self.modelsLoading else { return }
        self.modelsLoading = true
        self.modelsError = nil
        self.modelCatalogReloadBump += 1
        defer { self.modelsLoading = false }
        do {
            let loaded = try await ModelCatalogLoader.load(from: self.modelCatalogPath)
            self.modelsCount = loaded.count
        } catch {
            self.modelsCount = nil
            self.modelsError = error.localizedDescription
        }
    }

    private func sendVoiceDebug() async {
        await MainActor.run {
            self.debugSendInFlight = true
            self.debugSendError = nil
            self.debugSendStatus = nil
        }

        let result = await DebugActions.sendDebugVoice()

        await MainActor.run {
            self.debugSendInFlight = false
            switch result {
            case let .success(message):
                self.debugSendStatus = message
                self.debugSendError = nil
            case let .failure(error):
                self.debugSendStatus = nil
                self.debugSendError = error.localizedDescription
            }
        }
    }

    private func revealApp() {
        let url = Bundle.main.bundleURL
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func saveRelayRoot() {
        GatewayProcessManager.shared.setProjectRoot(path: self.gatewayRootInput)
    }

    private func loadSessionStorePath() {
        let url = self.configURL()
        guard
            let data = try? Data(contentsOf: url),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let session = parsed["session"] as? [String: Any],
            let path = session["store"] as? String
        else {
            self.sessionStorePath = SessionLoader.defaultStorePath
            return
        }
        self.sessionStorePath = path
    }

    private func saveSessionStorePath() {
        let trimmed = self.sessionStorePath.trimmingCharacters(in: .whitespacesAndNewlines)
        var root: [String: Any] = [:]
        let url = self.configURL()
        if let data = try? Data(contentsOf: url),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            root = parsed
        }

        var session = root["session"] as? [String: Any] ?? [:]
        session["store"] = trimmed.isEmpty ? SessionLoader.defaultStorePath : trimmed
        root["session"] = session

        do {
            let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
            try FileManager().createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            try data.write(to: url, options: [.atomic])
            self.sessionStoreSaveError = nil
        } catch {
            self.sessionStoreSaveError = error.localizedDescription
        }
    }

    private var bindingOverride: Binding<String> {
        Binding {
            self.iconOverrideRaw
        } set: { newValue in
            self.iconOverrideRaw = newValue
            if let selection = IconOverrideSelection(rawValue: newValue) {
                Task { @MainActor in
                    AppStateStore.shared.iconOverride = selection
                    WorkActivityStore.shared.resolveIconState(override: selection)
                }
            }
        }
    }

    private var isRemoteMode: Bool {
        CommandResolver.connectionSettings().mode == .remote
    }

    private var canRestartGateway: Bool {
        self.state.connectionMode == .local
    }

    private func configURL() -> URL {
        OpenClawPaths.configURL
    }
}

extension DebugSettings {
    // MARK: - Canvas debug actions

    @MainActor
    private func canvasPresent() async {
        self.canvasError = nil
        let session = self.canvasSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let dir = try CanvasManager.shared.show(sessionKey: session.isEmpty ? "main" : session, path: "/")
            self.canvasStatus = "dir: \(dir)"
        } catch {
            self.canvasError = error.localizedDescription
        }
    }

    @MainActor
    private func canvasWriteSamplePage() async {
        self.canvasError = nil
        let session = self.canvasSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let dir = try CanvasManager.shared.show(sessionKey: session.isEmpty ? "main" : session, path: "/")
            let url = URL(fileURLWithPath: dir).appendingPathComponent("index.html", isDirectory: false)
            let now = ISO8601DateFormatter().string(from: Date())
            let html = """
            <!doctype html>
            <html>
              <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Canvas Debug</title>
                <style>
                  :root { color-scheme: dark; }
                  html,body { height:100%; margin:0; background:#0b1020; color:#e5e7eb; }
                  body { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
                  .wrap { padding:16px; }
                  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
                  .pill { padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.08);
                          border:1px solid rgba(255,255,255,.12); }
                  button { background:#22c55e; color:#04110a; border:0; border-radius:10px;
                           padding:8px 10px; font-weight:700; cursor:pointer; }
                  button:active { transform: translateY(1px); }
                  .panel { margin-top:14px; padding:14px; border-radius:14px; background:rgba(255,255,255,.06);
                           border:1px solid rgba(255,255,255,.1); }
                  .grid { display:grid; grid-template-columns: repeat(12, 1fr); gap:10px; margin-top:12px; }
                  .box { grid-column: span 4; height:80px; border-radius:14px;
                         background: linear-gradient(135deg, rgba(59,130,246,.35), rgba(168,85,247,.25));
                         border:1px solid rgba(255,255,255,.12); }
                  .muted { color: rgba(229,231,235,.7); }
                </style>
              </head>
              <body>
                <div class="wrap">
                  <div class="row">
                    <div class="pill">Canvas Debug</div>
                    <div class="pill muted">generated: \(now)</div>
                    <div class="pill muted">userAgent: <span id="ua"></span></div>
                    <button id="btn">Click me</button>
                    <div class="pill">count: <span id="count">0</span></div>
                  </div>
                  <div class="panel">
                    <div class="muted">This is a local file served by the WKURLSchemeHandler.</div>
                    <div class="grid">
                      <div class="box"></div><div class="box"></div><div class="box"></div>
                      <div class="box"></div><div class="box"></div><div class="box"></div>
                    </div>
                  </div>
                </div>
                <script>
                  document.getElementById('ua').textContent = navigator.userAgent;
                  let n = 0;
                  document.getElementById('btn').addEventListener('click', () => {
                    n++;
                    document.getElementById('count').textContent = String(n);
                    document.title = 'Canvas Debug (' + n + ')';
                  });
                </script>
              </body>
            </html>
            """
            try html.write(to: url, atomically: true, encoding: .utf8)
            self.canvasStatus = "wrote: \(url.path)"
            _ = try CanvasManager.shared.show(sessionKey: session.isEmpty ? "main" : session, path: "/")
        } catch {
            self.canvasError = error.localizedDescription
        }
    }

    @MainActor
    private func canvasEval() async {
        self.canvasError = nil
        self.canvasEvalResult = nil
        do {
            let session = self.canvasSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try await CanvasManager.shared.eval(
                sessionKey: session.isEmpty ? "main" : session,
                javaScript: self.canvasEvalJS)
            self.canvasEvalResult = result
        } catch {
            self.canvasError = error.localizedDescription
        }
    }

    @MainActor
    private func canvasSnapshot() async {
        self.canvasError = nil
        self.canvasSnapshotPath = nil
        do {
            let session = self.canvasSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
            let path = try await CanvasManager.shared.snapshot(
                sessionKey: session.isEmpty ? "main" : session,
                outPath: nil)
            self.canvasSnapshotPath = path
        } catch {
            self.canvasError = error.localizedDescription
        }
    }
}

struct PlainSettingsGroupBoxStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            configuration.label
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            configuration.content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
struct DebugSettings_Previews: PreviewProvider {
    static var previews: some View {
        DebugSettings(state: .preview)
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}

@MainActor
extension DebugSettings {
    static func exerciseForTesting() async {
        let view = DebugSettings(state: .preview)
        view.modelsCount = 3
        view.modelsLoading = false
        view.modelsError = "Failed to load models"
        view.gatewayRootInput = "/tmp/openclaw"
        view.sessionStorePath = "/tmp/sessions.json"
        view.sessionStoreSaveError = "Save failed"
        view.debugSendInFlight = true
        view.debugSendStatus = "Sent"
        view.debugSendError = "Failed"
        view.portCheckInFlight = true
        view.portReports = [
            DebugActions.PortReport(
                port: GatewayEnvironment.gatewayPort(),
                expected: "Gateway websocket (node/tsx)",
                status: .missing("Missing"),
                listeners: []),
        ]
        view.portKillStatus = "Killed"
        view.pendingKill = DebugActions.PortListener(
            pid: 1,
            command: "node",
            fullCommand: "node",
            user: nil,
            expected: true)
        view.canvasSessionKey = "main"
        view.canvasStatus = "Canvas ok"
        view.canvasError = "Canvas error"
        view.canvasEvalJS = "document.title"
        view.canvasEvalResult = "Canvas"
        view.canvasSnapshotPath = "/tmp/snapshot.png"

        _ = view.body
        _ = view.header
        _ = view.appInfoSection
        _ = view.gatewaySection
        _ = view.logsSection
        _ = view.portsSection
        _ = view.pathsSection
        _ = view.quickActionsSection
        _ = view.canvasSection
        _ = view.experimentsSection
        _ = view.gridLabel("Test")

        view.loadSessionStorePath()
        await view.reloadModels()
    }
}
#endif
