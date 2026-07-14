export type PayoutActionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'checking'; message: string | null }
  | { status: 'awaiting-reconciliation'; message: string };

export type PayoutActionEvent =
  | { type: 'submit-started' }
  | { type: 'submit-succeeded' }
  | { type: 'submit-failed' }
  | { type: 'retry-started' }
  | { type: 'reload-succeeded' }
  | { type: 'reload-failed'; message: string };

export const initialPayoutActionState: PayoutActionState = { status: 'idle' };

export function payoutActionReducer(state: PayoutActionState, event: PayoutActionEvent): PayoutActionState {
  switch (event.type) {
    case 'submit-started':
      return { status: 'submitting' };
    case 'submit-succeeded':
      return { status: 'checking', message: null };
    case 'submit-failed':
    case 'reload-succeeded':
      return initialPayoutActionState;
    case 'retry-started':
      return state.status === 'awaiting-reconciliation'
        ? { status: 'checking', message: state.message }
        : state;
    case 'reload-failed':
      return state.status === 'checking'
        ? { status: 'awaiting-reconciliation', message: event.message }
        : state;
  }
}

export function payoutActionIsLocked(state: PayoutActionState): boolean {
  return state.status !== 'idle';
}
