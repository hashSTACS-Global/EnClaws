import SwiftUI

extension CronSettings {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            self.schedulerBanner
            self.content
            Spacer(minLength: 0)
        }
        .onAppear {
            self.store.start()
            self.channelsStore.start()
        }
        .onDisappear {
            self.store.stop()
            self.channelsStore.stop()
        }
        .sheet(isPresented: self.$showEditor) {
            CronJobEditor(
                job: self.editingJob,
                isSaving: self.$isSaving,
                error: self.$editorError,
                channelsStore: self.channelsStore,
                onCancel: {
                    self.showEditor = false
                    self.editingJob = nil
                },
                onSave: { payload in
                    Task {
                        await self.save(payload: payload)
                    }
                })
        }
        .alert("Delete cron job?", isPresented: Binding(
            get: { self.confirmDelete != nil },
            set: { if !$0 { self.confirmDelete = nil } }))
        {
            Button("取消", role: .cancel) { self.confirmDelete = nil }
            Button("删除", role: .destructive) {
                if let job = self.confirmDelete {
                    Task { await self.store.removeJob(id: job.id) }
                }
                self.confirmDelete = nil
            }
        } message: {
            if let job = self.confirmDelete {
                Text(job.displayName)
            }
        }
        .onChange(of: self.store.selectedJobId) { _, newValue in
                guard let newValue else { return }
                Task { await self.store.refreshRuns(jobId: newValue) }
            }
    }

    var schedulerBanner: some View {
        Group {
            if self.store.schedulerEnabled == false {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("定时调度已禁用")
                            .font(.headline)
                        Spacer()
                    }
                    Text(
                        "Jobs are saved, but they will not run automatically until `cron.enabled` is set to `true` " +
                            "and the Gateway restarts.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let storePath = self.store.schedulerStorePath, !storePath.isEmpty {
                        Text(storePath)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.orange.opacity(0.10))
                .cornerRadius(8)
            }
        }
    }

    var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("定时任务")
                    .font(.headline)
                Text("统筹管理网关定时任务和历史记录。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            HStack(spacing: 8) {
                Button {
                    Task { await self.store.refreshJobs() }
                } label: {
                    Label("强制加载刷新", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(self.store.isLoadingJobs)

                Button {
                    self.editorError = nil
                    self.editingJob = nil
                    self.showEditor = true
                } label: {
                    Label("新建任务", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    var content: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                if let err = self.store.lastError {
                    Text("错误: \(err)")
                        .font(.footnote)
                        .foregroundStyle(.red)
                } else if let msg = self.store.statusMessage {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                List(selection: self.$store.selectedJobId) {
                    ForEach(self.store.jobs) { job in
                        self.jobRow(job)
                            .tag(job.id)
                            .contextMenu { self.jobContextMenu(job) }
                    }
                }
                .listStyle(.inset)
            }
            .frame(width: 250)

            Divider()

            self.detail
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    var detail: some View {
        if let selected = self.selectedJob {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 12) {
                    self.detailHeader(selected)
                    self.detailCard(selected)
                    self.runHistoryCard(selected)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Select a job to inspect details and run history.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text("Tip: use ‘New Job’ to add one, or enable cron in your gateway config.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.top, 8)
        }
    }
}
