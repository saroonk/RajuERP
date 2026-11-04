import type { Services } from '../types';
import { accounts } from './finance';
import { admin, auth } from './admin';
import { dashboard, reports } from './reports';
import { distribution } from './distribution';
import { inventory } from './inventory';
import { masters } from './masters';
import { purchases } from './purchasing';
import { sales } from './sales';

/** `Services` implemented over the Django REST API (see backend/API.md). */
export const httpServices: Services = { auth, ...masters, inventory, purchases, distribution, sales, accounts, reports, dashboard, admin };
