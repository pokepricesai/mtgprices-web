'use client'

// CN-IDENTITY-02 · account-section identity panel for mtgprices-web.
//
// Renders two things in the existing /account page:
//   1. Membership status (Free / Premium + Discord link state)
//   2. Discord connect / disconnect
//
// Written as a client component so it can call
// supabase.auth.linkIdentity() directly from the browser (that
// method requires an active browser session). The server component
// at /account loads membership + link data and passes them in as
// props so no fetch happens client-side after hydration.

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import type { DiscordLink, MembershipSummary } from '@/lib/entitlements'

interface Props {
  membership: MembershipSummary | null
  discordLink: DiscordLink | null
  discordFlag?: string | null
}

export default function IdentityPanel({ membership, discordLink, discordFlag }: Props) {
  const tierLabel = membership?.tier === 'premium' ? 'Premium' : 'Free'
  const tierColor = membership?.tier === 'premium' ? 'var(--accent, #E8A94B)' : 'var(--text-muted)'
  const statusActive = membership?.status === 'active'
  const expiresAt = membership?.expires_at ? new Date(membership.expires_at) : null
  const expiresSoon = expiresAt && expiresAt.getTime() < Date.now() + 7 * 86_400_000
  const flashMessage = flashFromFlag(discordFlag ?? undefined)

  return (
    <section style={sectionStyle} aria-labelledby="identity-section-heading">
      <h2 id="identity-section-heading" style={h2Style}>
        Membership &amp; connections
      </h2>
      <p style={pStyle}>
        The same Collector Network account works across{' '}
        <strong>PokePrices</strong>,{' '}
        <strong>MTGPrices</strong>,{' '}
        <strong>YGOPrices</strong>,{' '}
        <strong>OnePiecePrices</strong> and{' '}
        <strong>LorcanaPrices</strong>. One subscription covers all five.
      </p>

      {flashMessage && (
        <div role="status" style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13,
          background: flashMessage.tone === 'ok' ? 'rgba(80,200,120,0.1)' : 'rgba(220,120,120,0.1)',
          border: `1px solid ${flashMessage.tone === 'ok' ? 'rgba(80,200,120,0.35)' : 'rgba(220,120,120,0.35)'}`,
          color: 'var(--text)',
        }}>
          {flashMessage.text}
        </div>
      )}

      <div style={gridStyle}>
        <div style={tileStyle}>
          <div className="label-mono" style={{ color: 'var(--text-muted)' }}>Plan</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: tierColor, marginTop: 4 }}>
            {tierLabel}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {!membership && 'Membership is being provisioned. Refresh in a moment.'}
            {membership && statusActive && membership.tier === 'free' && (
              'Stock alerts and undervalued eBay deals launching soon — free accounts get access.'
            )}
            {membership && statusActive && membership.tier === 'premium' && (
              expiresAt
                ? `Active until ${expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${expiresSoon ? ' (renews soon)' : ''}`
                : 'Active'
            )}
            {membership && !statusActive && (
              `Status: ${membership.status}. Contact support if this is unexpected.`
            )}
          </div>
        </div>

        <div style={tileStyle}>
          <div className="label-mono" style={{ color: 'var(--text-muted)' }}>Discord</div>
          {discordLink ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                {discordLink.discord_username ?? 'Discord account'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Linked {new Date(discordLink.linked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <form action="/api/auth/discord-link/disconnect" method="POST" style={{ marginTop: 10 }}>
                <button type="submit" className="btn btn-sm btn-ghost" style={buttonStyle}>
                  Disconnect
                </button>
              </form>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                Connect Discord to be eligible for member-only alert channels when they launch. Linking Discord does not change your plan.
              </div>
              <button
                type="button"
                className="btn btn-sm"
                style={{ ...buttonStyle, marginTop: 12, background: '#5865F2', borderColor: '#5865F2', color: '#fff' }}
                onClick={handleConnectDiscord}
              >
                Connect Discord
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function handleConnectDiscord() {
  const supabase = getSupabaseBrowserClient()
  const redirectTo = `${window.location.origin}/api/auth/discord-link/callback`
  supabase.auth.linkIdentity({
    provider: 'discord',
    options: {
      redirectTo,
      scopes: 'identify email',
    },
  }).then(({ error }) => {
    if (error) {
      window.location.href = `/account?discord=${encodeURIComponent(error.message.includes('already') ? 'already_linked' : 'link_failed')}`
    }
  })
}

function flashFromFlag(flag: string | undefined): { tone: 'ok' | 'err'; text: string } | null {
  if (!flag) return null
  const map: Record<string, { tone: 'ok' | 'err'; text: string }> = {
    connected: { tone: 'ok', text: 'Discord connected. You are now eligible for member-only alert channels once they launch.' },
    disconnected: { tone: 'ok', text: 'Discord disconnected. You can reconnect at any time.' },
    already_linked: { tone: 'err', text: 'That Discord account is already linked to another Collector Network account. Sign in to that account to manage it, or contact support.' },
    denied: { tone: 'err', text: 'Discord sign-in was cancelled. You can try again any time.' },
    link_failed: { tone: 'err', text: 'Discord linking failed. Please try again; if this persists, reach out to support.' },
    exchange_failed: { tone: 'err', text: 'Could not complete the Discord link. Please try again.' },
    no_session: { tone: 'err', text: 'Sign in again before connecting Discord.' },
    no_discord_identity: { tone: 'err', text: 'Discord did not return an identity. Please try again.' },
    disconnect_failed: { tone: 'err', text: 'Failed to disconnect Discord. Please try again.' },
    identity_removal_failed: { tone: 'err', text: 'Discord is still attached to your account — we could not fully remove the sign-in identity. Please try Disconnect again or contact support.' },
    invalid: { tone: 'err', text: 'Invalid Discord callback.' },
  }
  return map[flag] ?? null
}

const sectionStyle: React.CSSProperties = {
  marginTop: 28,
  padding: 24,
  border: '1px solid var(--border)',
  borderRadius: 14,
  background: 'var(--surface)',
}
const h2Style: React.CSSProperties = { margin: 0, fontSize: 18 }
const pStyle: React.CSSProperties = { margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }
const gridStyle: React.CSSProperties = {
  marginTop: 18, display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14,
}
const tileStyle: React.CSSProperties = {
  padding: 16, border: '1px solid var(--border)', borderRadius: 10,
  background: 'var(--bg-light, var(--surface))',
}
const buttonStyle: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  border: '1px solid var(--border)', borderRadius: 8,
  cursor: 'pointer', background: 'transparent',
}
