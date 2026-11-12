/**
 * Small phrases several parts of the interface share, in the language of the
 * moment.
 */

import { viewpointIndex } from '../core/iso.js';
import { t } from '../i18n/index.js';

/** The point of the compass the camera looks from, as the rose names it. */
export const pointName = (yaw) => t(`rose.${viewpointIndex(yaw)}`);
