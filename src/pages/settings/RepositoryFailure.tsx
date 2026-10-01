import { CircleAlert, KeyRound, Trash2 } from "lucide-react";
import type { LocalApiError } from "../../lib/local-api";
import { FIELD } from "./Field";

export function RepositoryFailure({ failure, message, token, onTokenChange, onForget, busy }: { failure: LocalApiError; message: string; token: string; onTokenChange: (value: string) => void; onForget: () => void; busy: boolean }) {
  const authFailure = failure.code === "repository_auth_required" || failure.code === "repository_forbidden";
  const title = failure.code === "repository_auth_required" ? "Authentication required" : failure.code === "repository_forbidden" ? "Repository access denied" : failure.code === "repository_timeout" ? "Repository timed out" : "Repository unavailable";
  const guidance = failure.code === "repository_auth_required"
    ? "Authenticate with your Git credential helper or provide a session token below."
    : failure.code === "repository_forbidden"
      ? "Confirm read access and, where required, approve the credential for organization SSO."
      : failure.code === "repository_timeout"
        ? "Check connectivity, VPN and proxy settings. The retry stays on this step."
        : "Verify the repository URL and ref before retrying.";
  const scope = failure.provider === "GitHub" ? "Use a fine-grained token with Contents: Read, or a classic token with repo access." : "Use a token with the read_repository scope.";
  return (
    <div role="alert" className="mt-4 rounded-control border border-unresolved bg-surface px-3 py-3">
      <div className="flex items-start gap-3">
        <CircleAlert size={18} className="mt-0.5 shrink-0 text-unresolved" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{title}</span>
            <span className="chip status-unresolved">{failure.status}</span>
            {failure.provider ? <span className="chip status-declared">{failure.provider}</span> : null}
          </div>
          <p className="mt-1 text-muted">{message}</p>
          <p className="mt-2 text-muted">{guidance}</p>
          {authFailure && failure.credentialSupported ? (
            <div className="mt-3 rounded-control border border-line bg-canvas p-3">
              <div className="flex items-center gap-2 font-medium text-ink">
                <KeyRound size={15} /> {failure.credentialPresent ? "Replace session token" : "Use an access token"}
              </div>
              <p className="mt-1 text-muted">{scope} It stays only in this local process and is forgotten when the server stops.</p>
              <label className="mt-3 block">
                <span className="label mb-1.5 block">{failure.provider} access token</span>
                <input
                  className={FIELD}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(event) => onTokenChange(event.target.value)}
                  placeholder="token is never written to the repository"
                />
              </label>
              {failure.credentialPresent ? (
                <button type="button" className="tbtn mt-3" onClick={onForget} disabled={busy}>
                  <Trash2 size={14} /> Forget saved token
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
