/**
 * Unit tests for OrderStatus component logic.
 * Validates: Requirements 9.4
 *
 * Tests the workflow step mapping logic that determines
 * which step to display based on order status.
 */

import { getWorkflowStep } from '../OrderStatus';

describe('OrderStatus - getWorkflowStep', () => {
  it('maps "pending" status to "ValidateOrder" step', () => {
    expect(getWorkflowStep('pending')).toBe('ValidateOrder');
  });

  it('maps "processing" status to "ReserveInventory" step', () => {
    expect(getWorkflowStep('processing')).toBe('ReserveInventory');
  });

  it('maps "charging" status to "ChargePayment" step', () => {
    expect(getWorkflowStep('charging')).toBe('ChargePayment');
  });

  it('maps "completed" status to "ConfirmOrder" step', () => {
    expect(getWorkflowStep('completed')).toBe('ConfirmOrder');
  });

  it('maps "failed" status to "Failed" step', () => {
    expect(getWorkflowStep('failed')).toBe('Failed');
  });

  it('returns the raw status for unknown values', () => {
    expect(getWorkflowStep('unknown')).toBe('unknown');
    expect(getWorkflowStep('custom-status')).toBe('custom-status');
  });
});
