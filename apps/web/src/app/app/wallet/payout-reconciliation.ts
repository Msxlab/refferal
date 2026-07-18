export type PayoutActionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'checking'; payoutId: string; message: string | null }
  | { status: 'awaiting-reconciliation'; payoutId: string; message: string };

export type PayoutActionEvent =
  | { type: 'submit-started' }
  | { type: 'submit-succeeded'; payoutId: string }
  | { type: 'submit-failed' }
  | { type: 'retry-started' }
  | { type: 'reload-succeeded'; payoutId: string }
  | { type: 'reload-failed'; payoutId: string; message: string };

export const initialPayoutActionState: PayoutActionState = { status: 'idle' };

export function payoutActionReducer(state: PayoutActionState, event: PayoutActionEvent): PayoutActionState {
  switch (event.type) {
    case 'submit-started':
      return state.status === 'idle' ? { status: 'submitting' } : state;
    case 'submit-succeeded':
      return state.status === 'submitting'
        ? { status: 'checking', payoutId: event.payoutId, message: null }
        : state;
    case 'submit-failed':
      return state.status === 'submitting' ? initialPayoutActionState : state;
    case 'retry-started':
      return state.status === 'awaiting-reconciliation'
        ? { status: 'checking', payoutId: state.payoutId, message: state.message }
        : state;
    case 'reload-succeeded':
      return state.status === 'checking' && state.payoutId === event.payoutId
        ? initialPayoutActionState
        : state;
    case 'reload-failed':
      return state.status === 'checking' && state.payoutId === event.payoutId
        ? {
            status: 'awaiting-reconciliation',
            payoutId: state.payoutId,
            message: event.message,
          }
        : state;
  }
}

export function payoutActionIsLocked(state: PayoutActionState): boolean {
  return state.status !== 'idle';
}

interface PayoutStatusItem {
  status: string;
}

interface PayoutHistoryItem extends PayoutStatusItem {
  id: string;
}

function isOpenPayoutStatus(status: string): boolean {
  return status === 'requested' || status === 'processing';
}

export function hasOpenPayoutRequest(history: readonly PayoutStatusItem[]): boolean {
  return history.some((payout) => isOpenPayoutStatus(payout.status));
}

export function payoutHistoryReconciles(history: readonly PayoutHistoryItem[], payoutId: string): boolean {
  return history.some((payout) => payout.id === payoutId);
}
