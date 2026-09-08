import { chooseDelay } from './backoffPolicy';
import { canRetry } from './retryBudget';
export function retryDelivery(attempt: number, maximum: number): number | null {
  if (!canRetry(attempt, maximum)) return null;
  return chooseDelay(attempt);
}
