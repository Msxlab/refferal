'use client';

/** Sticky "Unsaved changes" cubugu: Save / Discard. dirty=false iken hicbir sey gostermez. */
export function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div
      className="card"
      role="region"
      aria-label="Unsaved changes"
      style={{
        position: 'sticky',
        bottom: 12,
        zIndex: 20,
        marginTop: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderColor: 'var(--gold-500)',
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>Unsaved changes</span>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost sm" onClick={onDiscard} disabled={busy}>Discard</button>
        <button className="btn sm" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
