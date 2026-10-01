export const FIELD = "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";

export function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <input className={FIELD} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />
    </label>
  );
}
