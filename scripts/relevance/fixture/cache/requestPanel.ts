import { requestResource } from './resourceRegistry.js';
export function renderResourcePanel(key: string, cache: Map<string, unknown>) {
  return requestResource(key, cache);
}
