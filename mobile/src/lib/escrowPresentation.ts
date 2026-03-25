import type { Escrow, EscrowStatus } from './types';

type PartyRoleCopy = {
  sender: string;
  recipient: string;
};

type TransactionPresentation = {
  label: string;
  senderRole: string;
  recipientRole: string;
  senderSummary: string;
  recipientSummary: string;
};

const TRANSACTION_COPY: Record<string, TransactionPresentation> = {
  physical_product: {
    label: 'Physical Product',
    senderRole: 'Buyer',
    recipientRole: 'Seller',
    senderSummary: 'You are paying for a physical item that should be delivered before funds are released.',
    recipientSummary: 'You must deliver the physical item and provide the delivery code flow evidence to receive funds.',
  },
  digital_product: {
    label: 'Digital Product',
    senderRole: 'Buyer',
    recipientRole: 'Seller',
    senderSummary: 'You are paying for a digital item and should release funds after confirming access or delivery.',
    recipientSummary: 'You must provide the digital item or access, then wait for the sender to release the funds.',
  },
  service: {
    label: 'Service',
    senderRole: 'Client',
    recipientRole: 'Provider',
    senderSummary: 'You are hiring the recipient for a service and should release funds after the work is accepted.',
    recipientSummary: 'You are expected to complete the service and then request or wait for approval before release.',
  },
  currency_exchange: {
    label: 'Trade Agreement',
    senderRole: 'Trader',
    recipientRole: 'Counterparty',
    senderSummary: 'You are funding a trade agreement and should only release after the external exchange is evidenced.',
    recipientSummary: 'You must complete your side of the trade and provide receipt evidence for the sender to verify.',
  },
  instant: {
    label: 'Instant Transfer',
    senderRole: 'Sender',
    recipientRole: 'Receiver',
    senderSummary: 'This is meant for immediate handoff, so confirm quickly and release once the exchange is done.',
    recipientSummary: 'This transfer is expected to complete immediately once the handoff is done.',
  },
  donation: {
    label: 'Donation',
    senderRole: 'Donor',
    recipientRole: 'Beneficiary',
    senderSummary: 'You are voluntarily supporting the recipient. This is not structured like a disputed delivery contract.',
    recipientSummary: 'You are receiving a voluntary donation from the sender.',
  },
  custom: {
    label: 'Custom Agreement',
    senderRole: 'Initiator',
    recipientRole: 'Counterparty',
    senderSummary: 'This contract follows custom terms. Make sure the reference and note clearly describe the agreement.',
    recipientSummary: 'This contract follows custom terms. Review the note and reference carefully before acting.',
  },
  other: {
    label: 'General Contract',
    senderRole: 'Initiator',
    recipientRole: 'Counterparty',
    senderSummary: 'This transaction uses a general escrow contract. Use the note and reference to confirm the agreement.',
    recipientSummary: 'This transaction uses a general escrow contract. Review the note and reference before proceeding.',
  },
};

const COMPLETION_METHOD_COPY: Record<string, PartyRoleCopy> = {
  delivery_code: {
    sender: 'Release depends on a delivery code after the product is delivered.',
    recipient: 'Enter or complete the delivery code flow after delivery to unlock release.',
  },
  sender_release: {
    sender: 'You control final release after you confirm the contract is fulfilled.',
    recipient: 'Funds are released when the sender confirms the contract is fulfilled.',
  },
  service_approval: {
    sender: 'Release should happen after you review and approve the service outcome.',
    recipient: 'Complete the service first, then wait for sender approval and release.',
  },
  receipt_evidence: {
    sender: 'Review the evidence submitted for the trade before releasing funds.',
    recipient: 'Upload receipt evidence so the sender can verify and release funds.',
  },
  dispute_resolution: {
    sender: 'This contract may require manual dispute resolution before final settlement.',
    recipient: 'This contract may require manual dispute resolution before final settlement.',
  },
  mutual_cancellation: {
    sender: 'This contract can be cancelled when both sides agree.',
    recipient: 'This contract can be cancelled when both sides agree.',
  },
};

function getPresentation(transactionType?: Escrow['transaction_type']): TransactionPresentation {
  return TRANSACTION_COPY[transactionType || 'other'] || TRANSACTION_COPY.other;
}

export function getEscrowTypeLabel(transactionType?: Escrow['transaction_type']): string {
  return getPresentation(transactionType).label;
}

export function getEscrowRoleLabel(escrow: Escrow, currentUserId: string): string {
  const presentation = getPresentation(escrow.transaction_type);
  return escrow.sender_id === currentUserId ? presentation.senderRole : presentation.recipientRole;
}

export function getEscrowCounterpartyRoleLabel(escrow: Escrow, currentUserId: string): string {
  const presentation = getPresentation(escrow.transaction_type);
  return escrow.sender_id === currentUserId ? presentation.recipientRole : presentation.senderRole;
}

export function getEscrowSummary(escrow: Escrow, currentUserId: string): string {
  const presentation = getPresentation(escrow.transaction_type);
  return escrow.sender_id === currentUserId ? presentation.senderSummary : presentation.recipientSummary;
}

export function getEscrowCompletionHint(escrow: Escrow, currentUserId: string): string | null {
  const copy = COMPLETION_METHOD_COPY[escrow.completion_method || ''];
  if (!copy) return null;
  return escrow.sender_id === currentUserId ? copy.sender : copy.recipient;
}

export function getEscrowStatusGuidance(escrow: Escrow, currentUserId: string): string {
  const isSender = escrow.sender_id === currentUserId;
  const status = (escrow.status || '').toLowerCase() as EscrowStatus;

  switch (status) {
    case 'deposit_pending':
      return isSender
        ? 'Your escrow exists, but the deposit is still being confirmed. Funds are not secured yet.'
        : 'The sender has created this contract, but the deposit is still being confirmed.';
    case 'funds_held':
    case 'deposit_confirmed':
      return isSender
        ? 'Funds are secured in escrow. Wait for the recipient to fulfill their side before release.'
        : 'Funds are secured in escrow. Fulfill your side of the contract to become eligible for release.';
    case 'delivery_in_progress':
      return isSender
        ? 'Delivery is in progress. Release only after the contract terms are fulfilled.'
        : 'Delivery is in progress. Complete the handoff and follow the contract completion method.';
    case 'release_requested':
    case 'release_pending':
      return isSender
        ? 'The recipient has asked for release. Verify the contract outcome before approving.'
        : 'Release has been requested. Wait for the sender to confirm and release funds.';
    case 'completed':
      return isSender
        ? 'This contract is complete and the funds have been released.'
        : 'This contract is complete and the funds have been paid out to you.';
    case 'refunded':
      return isSender
        ? 'This contract ended in a refund back to you.'
        : 'This contract ended in a refund to the sender.';
    case 'disputed':
      return 'This contract is in dispute and is waiting for review or supporting evidence.';
    case 'deposit_failed':
      return isSender
        ? 'The deposit did not complete. Retry funding the escrow before continuing the contract.'
        : 'The sender\'s deposit did not complete, so this contract is not funded yet.';
    case 'cancelled':
    case 'expired':
      return 'This contract is no longer active.';
    default:
      return isSender
        ? 'Review the contract details and complete the next sender action when ready.'
        : 'Review the contract details and complete your part when instructed.';
  }
}