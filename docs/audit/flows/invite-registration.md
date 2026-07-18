# Flow Audit: Invite Registration

## Flow

1. Member creates invite.
2. Invite link is shared.
3. Public route resolves invite code.
4. Invitee registers.
5. Membership is created under inviter/tenant.
6. Email verification notification is queued.

## Strengths

- Invite and tenant active states are checked.
- Inviter active state is checked.
- Invite caps reduce uncontrolled invite creation.
- Invite email lock exists.

## Breakpoints

- No revoke flow is exposed.
- No opened/conversion tracking exists.
- Public resolve exposes inviter name without an explicit privacy setting.

## Linked Findings

- AUD-M09
