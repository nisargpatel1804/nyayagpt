export default function EmptyState() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center text-muted">
      <h2 className="text-2xl font-semibold text-white">
        How can I help you with Indian Law today?
      </h2>
      <div className="mt-6 grid gap-3 text-sm">
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          What is Section 302 IPC?
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          Explain Article 21 of the Constitution.
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          What does CrPC say about bail?
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          What is the difference between FIR and charge sheet?
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          When is anticipatory bail granted under CrPC?
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          Summarize Article 19 freedoms with limitations.
        </div>
      </div>
    </div>
  );
}